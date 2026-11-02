"""
Explainable Risk Score Engine (0–100) — backend/app/services/scanner/risk.py (PART B — B4)

Implements:
- Configurable per-entity severity weights (ENTITY_WEIGHTS)
- Diminishing-returns entity score formula:
    score_e = weight * avg_confidence * (1 + log2(unique_count))
- Combination bonuses:
    * PERSON + Government ID (IN_AADHAAR / IN_PAN / IN_PASSPORT / IN_VOTER_ID) -> +10 ("Identity exposure")
    * PERSON + Health data (HEALTH_TERM / MEDICAL_LICENSE) -> +10 ("Clinical privacy exposure")
    * PERSON + Financial account (BANK_ACCOUNT / CREDIT_CARD) -> +10 ("Financial account exposure")
    * Any SECRETS -> +15 ("Active credentials / cryptographic keys exposure")
- Explicit confidentiality marking bonus: +5
- Document-level classifier category bonus: up to +10
- Final score = min(100, round(sum))
- Risk levels: LOW (0–29), MEDIUM (30–59), HIGH (60–79), CRITICAL (80–100)
"""

import math
from typing import List, Dict, Any
from app.services.scanner.recognizers import get_entity_category, classify_document_text

# Configurable severity weights and per-type caps
ENTITY_WEIGHTS: Dict[str, float] = {
    "SECRETS": 40.0,
    "IN_AADHAAR": 30.0,
    "CREDIT_CARD": 30.0,
    "IN_PASSPORT": 28.0,
    "BANK_ACCOUNT": 14.0,
    "IBAN_CODE": 14.0,
    "IN_PAN": 22.0,
    "IN_VOTER_ID": 16.0,
    "HEALTH_TERM": 14.0,
    "MEDICAL_LICENSE": 14.0,
    "IN_UPI_ID": 10.0,
    "IN_GSTIN": 7.0,
    "IN_IFSC": 6.0,
    "IN_PHONE": 5.0,
    "PHONE_NUMBER": 5.0,
    "IN_VEHICLE_REG": 6.0,
    "EMAIL_ADDRESS": 4.0,
    "IP_ADDRESS": 4.0,
    "PERSON": 4.0,
    "LOCATION": 2.5,
    "ORG": 1.5,
    "MONEY": 1.0,
    "URL": 2.0,
    "DATE_TIME": 1.0,
}

ENTITY_CAPS: Dict[str, float] = {
    "SECRETS": 70.0,
    "IN_AADHAAR": 60.0,
    "CREDIT_CARD": 60.0,
    "IN_PASSPORT": 50.0,
    "BANK_ACCOUNT": 50.0,
    "IBAN_CODE": 50.0,
    "IN_PAN": 50.0,
    "IN_VOTER_ID": 25.0,
    "HEALTH_TERM": 18.0,
    "MEDICAL_LICENSE": 14.0,
    "IN_UPI_ID": 25.0,
    "IN_GSTIN": 25.0,
    "IN_IFSC": 20.0,
    "IN_PHONE": 20.0,
    "PHONE_NUMBER": 20.0,
    "IN_VEHICLE_REG": 20.0,
    "EMAIL_ADDRESS": 15.0,
    "IP_ADDRESS": 12.0,
    "PERSON": 10.0,
    "LOCATION": 8.0,
    "ORG": 8.0,
    "MONEY": 8.0,
    "URL": 6.0,
    "DATE_TIME": 4.0,
}

ENTITY_DISPLAY_LABELS: Dict[str, str] = {
    "SECRETS": "Secrets & Private Keys",
    "IN_AADHAAR": "Indian Aadhaar Numbers",
    "CREDIT_CARD": "Credit Card Numbers",
    "IN_PASSPORT": "Indian Passports",
    "BANK_ACCOUNT": "Bank Account Numbers",
    "IBAN_CODE": "IBAN Numbers",
    "IN_PAN": "Indian PAN Cards",
    "IN_VOTER_ID": "Voter ID (EPIC)",
    "HEALTH_TERM": "Clinical / Health Records",
    "MEDICAL_LICENSE": "Medical Registration Numbers",
    "IN_UPI_ID": "UPI IDs",
    "IN_GSTIN": "GSTIN Tax Identifiers",
    "IN_IFSC": "Bank IFSC Codes",
    "IN_PHONE": "Phone Numbers (IN)",
    "PHONE_NUMBER": "Phone Numbers",
    "IN_VEHICLE_REG": "Vehicle Registrations",
    "EMAIL_ADDRESS": "Email Addresses",
    "IP_ADDRESS": "IP Addresses",
    "PERSON": "Person Names",
    "LOCATION": "Locations",
    "ORG": "Organizations",
    "MONEY": "Monetary Amounts",
    "URL": "URLs",
    "DATE_TIME": "Dates & Times",
}


def score_to_risk_level(score: int) -> str:
    if score >= 76:
        return "CRITICAL"
    if score >= 51:
        return "HIGH"
    if score >= 26:
        return "MEDIUM"
    return "LOW"


def calculate_risk_score(
    findings: List[Dict[str, Any]],
    full_text: str = ""
) -> Dict[str, Any]:
    """
    Computes the explainable 0-100 risk score, level, contributor breakdown,
    category summary, one-line verdict, and plain-language recommendations.

    Each item in `findings` must have at least:
      - entity_type: str
      - confidence: float
      - value_hash: str (or masked_value)
      - page_number: int (optional, defaults to 1)
    """
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    category_summary: Dict[str, int] = {
        "Identity": 0,
        "Financial": 0,
        "Health": 0,
        "Credentials": 0,
        "Contact": 0,
        "Legal/HR": 0,
    }
    page_heatmap: Dict[str, int] = {}

    for f in findings:
        etype = f.get("entity_type", "UNKNOWN")
        conf = float(f.get("confidence", 0.8))
        if conf < 0.4:
            continue
        grouped.setdefault(etype, []).append(f)
        cat = f.get("category") or get_entity_category(etype)
        category_summary[cat] = category_summary.get(cat, 0) + 1
        pno = str(f.get("page_number", 1))
        page_heatmap[pno] = page_heatmap.get(pno, 0) + 1

    breakdown: List[Dict[str, Any]] = []
    raw_total = 0.0

    # 1. Per-entity logarithmic score
    for etype, items in grouped.items():
        weight = ENTITY_WEIGHTS.get(etype, 2.0)
        count = len(items)
        unique_hashes = {item.get("value_hash") or item.get("masked_value") or str(i) for i, item in enumerate(items)}
        unique_count = max(1, len(unique_hashes))
        avg_conf = sum(float(x.get("confidence", 0.8)) for x in items) / count

        cap = ENTITY_CAPS.get(etype, 20.0)
        points = min(cap, weight * avg_conf * (1.0 + math.log2(unique_count)))
        points_rounded = round(points, 1)
        raw_total += points

        breakdown.append({
            "label": f"{ENTITY_DISPLAY_LABELS.get(etype, etype)} ({unique_count} unique)",
            "entity_type": etype,
            "count": count,
            "unique_count": unique_count,
            "avg_confidence": round(avg_conf, 2),
            "points": points_rounded,
        })

    present_types = set(grouped.keys())
    doc_class = classify_document_text(full_text) if full_text else {
        "category_bonus": 0.0,
        "dominant_category": None,
        "has_explicit_marking": False,
        "marking_bonus": 0.0,
        "markings_found": [],
    }

    # 2. Combination bonuses
    has_person = "PERSON" in present_types
    has_gov_id = bool(present_types.intersection({"IN_AADHAAR", "IN_PAN", "IN_PASSPORT", "IN_VOTER_ID"}))
    has_health = bool(present_types.intersection({"HEALTH_TERM", "MEDICAL_LICENSE"})) or (doc_class.get("dominant_category") == "HEALTH")
    has_bank_card = bool(present_types.intersection({"BANK_ACCOUNT", "CREDIT_CARD", "IBAN_CODE"}))
    has_secrets = "SECRETS" in present_types

    if has_person and has_gov_id:
        raw_total += 10.0
        breakdown.append({
            "label": "Combination bonus: Identity exposure (Person names + Government IDs)",
            "entity_type": "COMBO_IDENTITY",
            "count": 1,
            "unique_count": 1,
            "avg_confidence": 1.0,
            "points": 10.0,
        })

    if has_person and has_health:
        raw_total += 10.0
        breakdown.append({
            "label": "Combination bonus: Clinical privacy exposure (Person names + Health records)",
            "entity_type": "COMBO_HEALTH",
            "count": 1,
            "unique_count": 1,
            "avg_confidence": 1.0,
            "points": 10.0,
        })

    if has_person and has_bank_card:
        raw_total += 10.0
        breakdown.append({
            "label": "Combination bonus: Financial exposure (Person names + Bank/Card numbers)",
            "entity_type": "COMBO_FINANCIAL",
            "count": 1,
            "unique_count": 1,
            "avg_confidence": 1.0,
            "points": 10.0,
        })

    if has_secrets:
        raw_total += 15.0
        breakdown.append({
            "label": "Combination bonus: Active secrets or private keys present",
            "entity_type": "COMBO_SECRETS",
            "count": 1,
            "unique_count": 1,
            "avg_confidence": 1.0,
            "points": 15.0,
        })

    # 3. Explicit marking bonus (+5)
    if doc_class.get("has_explicit_marking"):
        raw_total += 5.0
        markings_str = ", ".join(doc_class.get("markings_found", [])[:2])
        breakdown.append({
            "label": f"Explicit confidentiality marking ({markings_str})",
            "entity_type": "MARKING_BONUS",
            "count": 1,
            "unique_count": 1,
            "avg_confidence": 1.0,
            "points": 5.0,
        })

    # 4. Document category classifier bonus (up to +10)
    cat_bonus = float(doc_class.get("category_bonus", 0.0))
    dom_cat = doc_class.get("dominant_category")
    if cat_bonus > 0 and dom_cat:
        # Cap bonus slightly if no high-risk entities are present so benign agendas stay LOW
        if not present_types.difference({"PERSON", "LOCATION", "DATE_TIME"}):
            cat_bonus = min(cat_bonus, 3.0)
        raw_total += cat_bonus
        breakdown.append({
            "label": f"Document classifier: {dom_cat.title()} context",
            "entity_type": f"CLASSIFIER_{dom_cat}",
            "count": 1,
            "unique_count": 1,
            "avg_confidence": 1.0,
            "points": round(cat_bonus, 1),
        })

    # Sort breakdown by points descending
    breakdown.sort(key=lambda x: x["points"], reverse=True)

    final_score = min(100, int(round(raw_total)))
    risk_level = score_to_risk_level(final_score)

    # Build human-readable one-line verdict & plain-language recommendations
    verdict = _build_verdict(risk_level, grouped)
    recommendations = _build_recommendations(risk_level, grouped, findings)

    return {
        "risk_score": final_score,
        "risk_level": risk_level,
        "risk_verdict": verdict,
        "risk_breakdown": breakdown,
        "category_summary": category_summary,
        "recommendations": recommendations,
        "page_heatmap": page_heatmap,
    }


def _build_verdict(risk_level: str, grouped: Dict[str, List[Dict[str, Any]]]) -> str:
    if risk_level == "CRITICAL":
        if "SECRETS" in grouped:
            cnt = len(grouped["SECRETS"])
            return f"Critical — contains {cnt} exposed credential/private key secret(s). Do not share the original file."
        if "IN_AADHAAR" in grouped:
            cnt = len(grouped["IN_AADHAAR"])
            return f"Critical — contains {cnt} Aadhaar number(s) linked to names. Share only a safe copy."
        return "Critical — high concentration of regulated identity and financial data. Approval required to share original."

    if risk_level == "HIGH":
        if "HEALTH_TERM" in grouped or "MEDICAL_LICENSE" in grouped:
            return "High — contains clinical patient records and medical identifiers. Share externally only as a safe copy."
        return "High — contains sensitive personal or financial records. Time-limited strict viewing enforced."

    if risk_level == "MEDIUM":
        return "Medium — contains business tax/banking identifiers or contact details. Watermarking and OTP enforced."

    return "Low — contains minimal or routine information. Safe for standard sharing."


def _build_recommendations(
    risk_level: str,
    grouped: Dict[str, List[Dict[str, Any]]],
    findings: List[Dict[str, Any]]
) -> List[str]:
    recs: List[str] = []
    if "SECRETS" in grouped:
        pages = sorted({str(f.get("page_number", 1)) for f in grouped["SECRETS"]})
        page_str = ", ".join(pages)
        recs.append(f"Remove the exposed AWS key, private key, or password from page(s) {page_str} and rotate the credentials immediately.")

    if "IN_AADHAAR" in grouped or "IN_PAN" in grouped:
        recs.append("Create a redacted safe copy before sharing with anyone outside HR or Finance.")

    if "BANK_ACCOUNT" in grouped or "CREDIT_CARD" in grouped:
        recs.append("Redact bank account and card numbers unless the recipient specifically needs settlement details.")

    if "HEALTH_TERM" in grouped or "MEDICAL_LICENSE" in grouped:
        recs.append("Use a redacted safe copy for external sharing to protect patient privacy.")

    if risk_level in ("HIGH", "CRITICAL"):
        recs.append("Create a safe copy before sharing outside the organisation, and protect it with a password.")
    elif risk_level == "MEDIUM":
        recs.append("Keep email OTP verification and watermarks enabled when sharing via external links.")
    else:
        recs.append("No high-risk identifiers found. Standard sharing controls apply.")

    return recs
