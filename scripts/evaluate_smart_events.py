"""Offline evaluation of saved model answers against a labelled quality set.

Usage: python -m scripts.evaluate_smart_events answers.json
Answers: {case_id: structured Smart Events model response}.
No network calls, secrets, or production calendar data.
"""
import json
import sys
from pathlib import Path
from app.smart_events import validate_result
from app.security import Problem


def evaluate(cases, answers):
    report = {'cases': len(cases), 'answered': 0, 'category_correct': 0,
              'critical_details_preserved': 0, 'failures': []}
    for case in cases:
        result = answers.get(case['id'])
        if result is None:
            report['failures'].append({'id': case['id'], 'reason': 'missing'})
            continue
        report['answered'] += 1
        report['category_correct'] += result.get('category_id') == case['expected_category']
        try:
            validate_result(result, case['input'])
            report['critical_details_preserved'] += 1
        except Problem as exc:
            report['failures'].append({'id': case['id'], 'reason': exc.code})
    return report


if __name__ == '__main__':
    cases = json.loads((Path(__file__).resolve().parents[1] / 'tests/fixtures/smart_quality.json').read_text())
    print(json.dumps(evaluate(cases, json.loads(Path(sys.argv[1]).read_text())), indent=2))
