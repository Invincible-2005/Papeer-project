import json
import sys
from pathlib import Path
import time
from uuid import uuid4

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage

from deepeval import evaluate
from deepeval.evaluate import AsyncConfig
from deepeval.metrics import (
    AnswerRelevancyMetric,
    ContextualPrecisionMetric,
    ContextualRecallMetric,
    ContextualRelevancyMetric,
    FaithfulnessMetric,
)
from deepeval.synthesizer import Synthesizer
from deepeval.synthesizer.config import ContextConstructionConfig
from deepeval.test_case import LLMTestCase

from backend.paper_loader import load_document
from backend.rag_graph import build_graph, clean_content
from backend.vector_store import add_paper

load_dotenv()

from deepeval.models.base_model import DeepEvalBaseLLM
from langchain_google_genai import ChatGoogleGenerativeAI

class GeminiModel(DeepEvalBaseLLM):
    def __init__(self, model_name="gemini-3.1-flash-lite"):
        self.model_name = model_name
        self.model = ChatGoogleGenerativeAI(model=model_name)

    def load_model(self):
        return self.model

    def generate(self, prompt: str, schema=None, **kwargs) -> str:
        retries = 5
        delay = 12
        for i in range(retries):
            try:
                if schema:
                    structured_model = self.model.with_structured_output(schema)
                    res = structured_model.invoke(prompt)
                    return res.model_dump_json()
                else:
                    return clean_content(self.model.invoke(prompt).content)
            except Exception as e:
                if "RESOURCE_EXHAUSTED" in str(e) or "429" in str(e):
                    print(f"Rate limited (429) in generate. Retrying in {delay}s...")
                    time.sleep(delay)
                    delay *= 2
                else:
                    raise e
        raise Exception("Max retries exceeded for rate limit in generate")

    async def a_generate(self, prompt: str, schema=None, **kwargs) -> str:
        import asyncio
        retries = 5
        delay = 12
        for i in range(retries):
            try:
                if schema:
                    structured_model = self.model.with_structured_output(schema)
                    res = await structured_model.ainvoke(prompt)
                    return res.model_dump_json()
                else:
                    res = await self.model.ainvoke(prompt)
                    return clean_content(res.content)
            except Exception as e:
                if "RESOURCE_EXHAUSTED" in str(e) or "429" in str(e):
                    print(f"Rate limited (429) in a_generate. Retrying in {delay}s...")
                    await asyncio.sleep(delay)
                    delay *= 2
                else:
                    raise e
        raise Exception("Max retries exceeded for rate limit in a_generate")

    def get_model_name(self):
        return self.model_name

PDF_PATH            = "documents/Openclaw_Research_Report.pdf"
GOLDENS_FILE        = Path("goldens.json")
MAX_CONTEXTS        = 5
GOLDENS_PER_CONTEXT = 2
METRIC_THRESHOLD    = 0.7


def generate_goldens() -> list[dict]:
    gemini_model = GeminiModel("gemini-1.5-flash")
    synthesizer = Synthesizer(model=gemini_model)
    goldens = synthesizer.generate_goldens_from_docs(
        document_paths=[PDF_PATH],
        include_expected_output=True,
        max_goldens_per_context=GOLDENS_PER_CONTEXT,
        context_construction_config=ContextConstructionConfig(
            max_contexts_per_document=MAX_CONTEXTS,
        ),
    )
    pairs = [
        {"input": g.input, "expected_output": g.expected_output}
        for g in goldens
        if g.input and g.expected_output
    ]
    GOLDENS_FILE.write_text(json.dumps(pairs, indent=2, ensure_ascii=False), encoding="utf-8")
    return pairs


def load_goldens() -> list[dict]:
    return json.loads(GOLDENS_FILE.read_text(encoding="utf-8"))


def run_rag_query(graph, query: str, session_id: str) -> tuple[str, list[str]]:
    config = {"configurable": {"thread_id": str(session_id)}}
    retries = 6
    delay = 30
    for attempt in range(retries):
        try:
            final_state = graph.invoke(
                {
                    "messages": [HumanMessage(content=query)],
                    "session_id": session_id,
                    "query": query,
                    "retrieved_docs": [],
                    "retrieval_attempts": 0,
                    "rewrite_count": 0,
                },
                config=config,
            )
            answer = final_state.get("answer") or ""
            retrieval_context = [doc.page_content for doc in (final_state.get("retrieved_docs") or [])]
            return answer, retrieval_context
        except Exception as e:
            if "RESOURCE_EXHAUSTED" in str(e) or "429" in str(e):
                print(f"RAG graph rate limited (429). Retrying in {delay}s... (attempt {attempt + 1}/{retries})")
                time.sleep(delay)
                delay = min(delay * 2, 120)
            else:
                raise e
    raise Exception("Max retries exceeded for rate limit in run_rag_query")


def main() -> None:
    pairs = load_goldens() if GOLDENS_FILE.exists() else generate_goldens()

    docs = load_document(PDF_PATH)
    graph = build_graph(db_path="eval_checkpoints.db")
    gemini_model = GeminiModel("gemini-3.1-flash-lite")

    metrics = [
        ContextualPrecisionMetric(threshold=METRIC_THRESHOLD, model=gemini_model, async_mode=False),
        ContextualRecallMetric(threshold=METRIC_THRESHOLD, model=gemini_model, async_mode=False),
        ContextualRelevancyMetric(threshold=METRIC_THRESHOLD, model=gemini_model, async_mode=False),
        AnswerRelevancyMetric(threshold=METRIC_THRESHOLD, model=gemini_model, async_mode=False),
        FaithfulnessMetric(threshold=METRIC_THRESHOLD, model=gemini_model, async_mode=False),
    ]

    test_cases = []
    for pair in pairs:
        session_id = f"evaluation_session_{uuid4()}"
        add_paper(docs, session_id)

        query = pair["input"] + " as per the report in knowledge base"
        answer, retrieval_context = run_rag_query(graph, query, session_id)
        test_cases.append(
            LLMTestCase(
                input=pair["input"],
                actual_output=answer,
                expected_output=pair["expected_output"],
                retrieval_context=retrieval_context,
            )
        )
        print(f"Generated test case {len(test_cases)}/{len(pairs)}. Sleeping 12s to avoid rate limit...")
        time.sleep(12)

    results_path = Path("eval_results.json")
    # Load any previously saved results so we can resume
    if results_path.exists():
        summary = json.loads(results_path.read_text(encoding="utf-8"))
    else:
        summary = []

    already_done = {item["input"] for item in summary}

    for idx, tc in enumerate(test_cases, 1):
        if tc.input in already_done:
            print(f"[{idx}/{len(test_cases)}] Skipping already-evaluated: {tc.input[:60]}...")
            continue

        print(f"\n[{idx}/{len(test_cases)}] Evaluating: {tc.input[:60]}...")
        try:
            result = evaluate(
                [tc],
                metrics,
                async_config=AsyncConfig(max_concurrent=1),
            )

            for test_result in result.test_results:
                entry = {
                    "input": test_result.input,
                    "actual_output": test_result.actual_output,
                    "success": test_result.success,
                    "metrics": [
                        {
                            "name": m.name,
                            "score": m.score,
                            "passed": m.success,
                            "reason": m.reason,
                        }
                        for m in test_result.metrics_data
                    ],
                }
                summary.append(entry)

            # Save after every successful test case
            results_path.write_text(
                json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print(f"  ✓ Saved. Total results so far: {len(summary)}")

        except Exception as e:
            print(f"  ✗ Failed: {e}")
            print(f"  Saving progress and continuing...")
            results_path.write_text(
                json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
            )

        # Sleep between test cases to respect rate limits
        if idx < len(test_cases):
            print(f"  Sleeping 15s to respect rate limits...")
            time.sleep(15)

    print(f"\nDone. {len(summary)} results saved to {results_path}.")


if __name__ == "__main__":
    main()