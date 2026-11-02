"""
Sensitive Data Recognizers & Document Classifiers (PART B — B2 & B3)
Includes:
1. Verhoeff checksum validation and generation for Indian Aadhaar (IN_AADHAAR).
2. Luhn checksum validation for CREDIT_CARD.
3. Custom regex + checksum + context-word recognizers for Indian PII & financial identifiers:
   IN_AADHAAR, IN_PAN, IN_GSTIN, IN_IFSC, IN_UPI_ID, IN_PASSPORT, IN_VOTER_ID,
   IN_VEHICLE_REG, IN_PHONE, BANK_ACCOUNT, SECRETS, MEDICAL_LICENSE, HEALTH_TERM.
4. Document-level keyword & phrase classifiers (FINANCIAL, HEALTH, LEGAL, HR, CREDENTIALS, and explicit markings).
5. Strict masking and salted hashing helpers ensuring raw sensitive values are NEVER persisted.
"""

import hashlib
import re
from dataclasses import dataclass, field
from typing import List, Dict, Any, Tuple, Optional

from app.core.config import settings
from app.services.crypto import encrypt_bytes, decrypt_bytes

# ==============================================================================
# 1. VERHOEFF CHECKSUM FOR INDIAN AADHAAR (12 digits, first digit 2-9)
# ==============================================================================
_VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]

_VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

_VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def verhoeff_validate(num_str: str) -> bool:
    """Returns True if num_str is a 12-digit string starting with 2-9 and valid Verhoeff checksum."""
    digits = re.sub(r"\D", "", num_str)
    if len(digits) != 12 or not digits.isdigit():
        return False
    if digits[0] in ("0", "1"):
        return False
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


def verhoeff_generate(eleven_digits: str) -> str:
    """Given an 11-digit string (starting 2-9), appends the valid Verhoeff 12th check digit."""
    clean = re.sub(r"\D", "", eleven_digits)
    if len(clean) != 11:
        raise ValueError("Eleven digits required to generate Verhoeff Aadhaar.")
    c = 0
    for i, ch in enumerate(reversed(clean)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[(i + 1) % 8][int(ch)]]
    check = _VERHOEFF_INV[c]
    full = clean + str(check)
    return f"{full[:4]} {full[4:8]} {full[8:]}"


def luhn_validate(card_str: str) -> bool:
    """Validates credit card numbers using the Luhn checksum algorithm."""
    digits = [int(c) for c in re.sub(r"\D", "", card_str)]
    if len(digits) < 13 or len(digits) > 19:
        return False
    if len(set(digits)) == 1:
        return False
    checksum = 0
    reverse_digits = digits[::-1]
    for i, d in enumerate(reverse_digits):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        checksum += d
    return checksum % 10 == 0


# ==============================================================================
# 2. ENTITY CATEGORY MAPPING & MASKING (B3 — Never store raw values)
# ==============================================================================
ENTITY_CATEGORY_MAP: Dict[str, str] = {
    "IN_AADHAAR": "Identity",
    "IN_PAN": "Identity",
    "IN_PASSPORT": "Identity",
    "IN_VOTER_ID": "Identity",
    "IN_VEHICLE_REG": "Identity",
    "PERSON": "Identity",
    "DATE_TIME": "Identity",
    "CREDIT_CARD": "Financial",
    "BANK_ACCOUNT": "Financial",
    "IBAN_CODE": "Financial",
    "IN_IFSC": "Financial",
    "IN_GSTIN": "Financial",
    "IN_UPI_ID": "Financial",
    "MONEY": "Financial",
    "HEALTH_TERM": "Health",
    "MEDICAL_LICENSE": "Health",
    "SECRETS": "Credentials",
    "EMAIL_ADDRESS": "Contact",
    "IN_PHONE": "Contact",
    "PHONE_NUMBER": "Contact",
    "LOCATION": "Contact",
    "IP_ADDRESS": "Contact",
    "URL": "Contact",
    "ORG": "Legal/HR",
    "LEGAL_HR_TERM": "Legal/HR",
}


def get_entity_category(entity_type: str) -> str:
    return ENTITY_CATEGORY_MAP.get(entity_type, "Legal/HR")


def mask_sensitive_value(entity_type: str, raw_value: str) -> str:
    """
    Produces a safe masked representation of a detected value.
    Raw sensitive value is NEVER returned intact.
    Examples:
      - IN_AADHAAR: "XXXX XXXX 4821"
      - IN_PAN: "ABCPX****F"
      - EMAIL_ADDRESS: "A****@gmail.com"
    """
    val = raw_value.strip()
    if not val:
        return "****"

    if entity_type == "IN_AADHAAR":
        digits = re.sub(r"\D", "", val)
        last4 = digits[-4:] if len(digits) >= 4 else "XXXX"
        return f"XXXX XXXX {last4}"

    if entity_type == "IN_PAN":
        clean = re.sub(r"\s+", "", val).upper()
        if len(clean) == 10:
            return f"{clean[:5]}****{clean[-1]}"
        return f"{clean[:3]}****{clean[-1]}" if len(clean) > 4 else "****"

    if entity_type == "EMAIL_ADDRESS" and "@" in val:
        local, domain = val.split("@", 1)
        first_char = local[0] if local else "u"
        return f"{first_char}****@{domain}"

    if entity_type in ("CREDIT_CARD", "BANK_ACCOUNT"):
        digits = re.sub(r"\D", "", val)
        last4 = digits[-4:] if len(digits) >= 4 else "XXXX"
        return f"XXXX XXXX {last4}"

    if entity_type in ("IN_PHONE", "PHONE_NUMBER"):
        digits = re.sub(r"\D", "", val)
        last4 = digits[-4:] if len(digits) >= 4 else "XXXX"
        prefix = "+91 " if val.strip().startswith("+91") else ""
        return f"{prefix}XXXXXX{last4}"

    if entity_type == "IN_IFSC":
        clean = val.strip().upper()
        return f"{clean[:4]}0****{clean[-2:]}" if len(clean) >= 7 else "****"

    if entity_type == "IN_GSTIN":
        clean = val.strip().upper()
        return f"{clean[:2]}*********Z{clean[-1]}" if len(clean) >= 6 else "****"

    if entity_type == "IN_UPI_ID" and "@" in val:
        handle, bank = val.split("@", 1)
        return f"{handle[:2]}****@{bank}"

    if entity_type in ("IN_PASSPORT", "IN_VOTER_ID", "IN_VEHICLE_REG", "IBAN_CODE", "MEDICAL_LICENSE"):
        clean = val.strip()
        if len(clean) > 4:
            return f"{clean[:2]}****{clean[-2:]}"
        return "****"

    if entity_type == "SECRETS":
        if "PRIVATE KEY" in val.upper():
            return "-----BEGIN PRIVATE KEY [REDACTED]-----"
        clean = val.strip()
        if ":" in clean or "=" in clean:
            sep = ":" if ":" in clean else "="
            k, v = clean.split(sep, 1)
            v_str = v.strip().strip("'\"")
            tail = v_str[-2:] if len(v_str) > 4 else "**"
            return f"{k.strip()}{sep} ******{tail}"
        if clean.startswith(("AKIA", "ASIA")) and len(clean) >= 8:
            return f"{clean[:4]}************{clean[-4:]}"
        return f"{clean[:3]}********{clean[-2:]}" if len(clean) > 6 else "********"

    if entity_type == "PERSON":
        parts = val.split()
        masked_parts = [f"{p[0]}***" if len(p) > 1 else "*" for p in parts]
        return " ".join(masked_parts)

    # Generic fallback: never leave raw value intact
    if len(val) <= 4:
        return "****"
    return f"{val[:2]}{'*' * min(8, len(val) - 3)}{val[-1]}"


def compute_salted_value_hash(entity_type: str, raw_value: str) -> str:
    """Computes salted SHA-256 hash of normalized value to count unique entities without storing plaintext."""
    norm = re.sub(r"[\s\-]", "", raw_value.strip().lower())
    material = f"{settings.SECRET_KEY}:finding:{entity_type}:{norm}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def encrypt_finding_value(raw_value: str) -> str:
    """Encrypts raw value with AES-256-GCM so only authorized reveal requests can decrypt it in memory."""
    ciphertext, iv_bytes, tag_bytes = encrypt_bytes(raw_value.encode("utf-8"))
    return f"{iv_bytes.hex()}:{tag_bytes.hex()}:{ciphertext.hex()}"


def decrypt_finding_value(encrypted_token: str) -> str:
    """Decrypts an encrypted finding value strictly in memory."""
    if not encrypted_token or ":" not in encrypted_token:
        return "[REDACTED]"
    iv_hex, tag_hex, ct_hex = encrypted_token.split(":", 2)
    pt = decrypt_bytes(bytes.fromhex(ct_hex), bytes.fromhex(iv_hex), bytes.fromhex(tag_hex))
    return pt.decode("utf-8", errors="replace")


def build_masked_context(full_text: str, start: int, end: int, masked_val: str, window: int = 30) -> str:
    """
    Builds an ~60-character context snippet around [start:end] with the sensitive value itself replaced by masked_val,
    and scrubs any adjacent digits/emails so no raw sensitive substring leaks in context.
    """
    left_idx = max(0, start - window)
    right_idx = min(len(full_text), end + window)
    prefix = full_text[left_idx:start].replace("\n", " ")
    suffix = full_text[end:right_idx].replace("\n", " ")

    # Scrub any other long numbers, GSTINs, PANs, AWS keys, or emails in prefix/suffix
    def _scrub_neighbor(s: str) -> str:
        s = re.sub(r"\b[2-9]\d{3}[\s\-]?\d{4}[\s\-]?\d{4}\b", "[AADHAAR]", s)
        s = re.sub(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b", "[GSTIN]", s)
        s = re.sub(r"[A-Z]{5}[0-9]{4}[A-Z]", "[PAN]", s)
        s = re.sub(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b", "[AWS_KEY]", s)
        s = re.sub(r"\b\d{9,18}\b", "[ACCT]", s)
        return s

    clean_prefix = _scrub_neighbor(prefix)
    clean_suffix = _scrub_neighbor(suffix)
    snippet = f"{clean_prefix}[{masked_val}]{clean_suffix}".strip()
    return snippet[:120]


# ==============================================================================
# 3. CUSTOM RECOGNIZER DEFINITIONS (Layer 2)
# ==============================================================================
@dataclass
class RawDetection:
    entity_type: str
    start: int
    end: int
    raw_value: str
    confidence: float
    detector_name: str
    page_number: int = 1
    bboxes: List[List[float]] = field(default_factory=list)


def _has_context(text_lower: str, start: int, end: int, keywords: List[str], window: int = 80) -> bool:
    ctx_start = max(0, start - window)
    ctx_end = min(len(text_lower), end + window)
    snippet = text_lower[ctx_start:ctx_end]
    return any(kw in snippet for kw in keywords)


def run_custom_recognizers(page_text: str, page_number: int = 1) -> List[RawDetection]:
    """
    Executes Layer 2 custom regex + checksum + context-word recognizers on page_text.
    """
    results: List[RawDetection] = []
    text_lower = page_text.lower()
    aadhaar_spans: List[Tuple[int, int]] = []

    # 1. IN_AADHAAR: 12 digits (first digit 2-9 for standard, 1-9 when explicit context word present)
    aadhaar_pattern = re.compile(r"(?<!\d)([1-9]\d{3}[\s\-\u00A0]?\d{4}[\s\-\u00A0]?\d{4})(?!\d)")
    aadhaar_keywords = ["aadhaar", "aadhar", "adhar", "uid", "uidai", "mera aadhaar", "unique identification"]
    for m in aadhaar_pattern.finditer(page_text):
        candidate = m.group(1)
        start_idx = m.start(1)
        end_idx = m.end(1)
        before_text = text_lower[max(0, start_idx - 60):start_idx]
        after_text = text_lower[end_idx:min(len(text_lower), end_idx + 40)]
        has_ctx = any(kw in before_text or kw in after_text for kw in aadhaar_keywords)
        is_valid_checksum = verhoeff_validate(candidate)
        first_digit = re.sub(r"\D", "", candidate)[0] if re.sub(r"\D", "", candidate) else "0"

        if is_valid_checksum and has_ctx:
            conf = 0.97
            detector = "custom_aadhaar_verhoeff"
        elif is_valid_checksum and not has_ctx and first_digit in "23456789":
            conf = 0.80
            detector = "custom_aadhaar_verhoeff"
        elif not is_valid_checksum and has_ctx:
            conf = 0.75
            detector = "custom_aadhaar_context"
        else:
            continue

        results.append(RawDetection(
            entity_type="IN_AADHAAR",
            start=start_idx,
            end=end_idx,
            raw_value=candidate,
            confidence=conf,
            detector_name=detector,
            page_number=page_number,
        ))
        aadhaar_spans.append((start_idx, end_idx))

    # 2. IN_PAN: [A-Z]{5}[0-9]{4}[A-Z]; context "pan", "income tax"
    pan_pattern = re.compile(r"\b([A-Z]{5}[0-9]{4}[A-Z])\b")
    pan_ctx = ["pan", "income tax", "permanent account", "tax id", "itd"]
    for m in pan_pattern.finditer(page_text):
        candidate = m.group(1)
        has_ctx = _has_context(text_lower, m.start(), m.end(), pan_ctx)
        conf = 0.95 if has_ctx else 0.82
        results.append(RawDetection(
            entity_type="IN_PAN",
            start=m.start(1),
            end=m.end(1),
            raw_value=candidate,
            confidence=conf,
            detector_name="custom_in_pan",
            page_number=page_number,
        ))

    # 3. IN_GSTIN: 2 digits + 10-char PAN + 1 entity code + Z + 1 check char
    gstin_pattern = re.compile(r"\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b")
    gstin_ctx = ["gstin", "gst", "tax", "invoice", "supplier"]
    for m in gstin_pattern.finditer(page_text):
        has_ctx = _has_context(text_lower, m.start(), m.end(), gstin_ctx)
        results.append(RawDetection(
            entity_type="IN_GSTIN",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.95 if has_ctx else 0.86,
            detector_name="custom_in_gstin",
            page_number=page_number,
        ))

    # 4. IN_IFSC: 4 uppercase letters + '0' + 6 alphanumeric characters
    ifsc_pattern = re.compile(r"\b([A-Z]{4}0[A-Z0-9]{6})\b")
    ifsc_ctx = ["ifsc", "bank", "branch", "neft", "rtgs", "imps", "account"]
    for m in ifsc_pattern.finditer(page_text):
        has_ctx = _has_context(text_lower, m.start(), m.end(), ifsc_ctx)
        results.append(RawDetection(
            entity_type="IN_IFSC",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.94 if has_ctx else 0.78,
            detector_name="custom_in_ifsc",
            page_number=page_number,
        ))

    # 5. IN_UPI_ID
    upi_pattern = re.compile(r"\b([a-zA-Z0-9.\-_]{2,48}@(?:okaxis|okhdfcbank|okicici|oksbi|ybl|paytm|ibl|axl|upi|apl|sbi|hdfcbank|icici))\b", re.IGNORECASE)
    for m in upi_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="IN_UPI_ID",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.90,
            detector_name="custom_in_upi",
            page_number=page_number,
        ))

    # 6. IN_PASSPORT: 1 letter + 7 digits (only when near passport context or strict format)
    passport_pattern = re.compile(r"\b([A-PR-WY][1-9]\d\s?\d{4}[1-9])\b")
    passport_ctx = ["passport", "travel document", "nationality", "republic of india"]
    for m in passport_pattern.finditer(page_text):
        has_ctx = _has_context(text_lower, m.start(), m.end(), passport_ctx)
        if has_ctx:
            results.append(RawDetection(
                entity_type="IN_PASSPORT",
                start=m.start(1),
                end=m.end(1),
                raw_value=m.group(1),
                confidence=0.92,
                detector_name="custom_in_passport",
                page_number=page_number,
            ))

    # 7. IN_VOTER_ID: 3 letters + 7 digits
    voter_pattern = re.compile(r"\b([A-Z]{3}[0-9]{7})\b")
    voter_ctx = ["voter", "epic", "election", "electoral"]
    for m in voter_pattern.finditer(page_text):
        if _has_context(text_lower, m.start(), m.end(), voter_ctx):
            results.append(RawDetection(
                entity_type="IN_VOTER_ID",
                start=m.start(1),
                end=m.end(1),
                raw_value=m.group(1),
                confidence=0.90,
                detector_name="custom_in_voter_id",
                page_number=page_number,
            ))

    # 8. IN_VEHICLE_REG: e.g. KA-01-AB-1234 or MH 12 DE 1433
    vehicle_pattern = re.compile(r"\b([A-Z]{2}[-\s][0-9]{2}[-\s][A-Z]{1,2}[-\s][0-9]{4})\b")
    for m in vehicle_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="IN_VEHICLE_REG",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.82,
            detector_name="custom_in_vehicle_reg",
            page_number=page_number,
        ))

    # 9. IN_PHONE: +91 or 10-digit Indian mobile starting 6-9
    phone_pattern = re.compile(r"(?<!\d)((?:\+91[\-\s]?)?[6-9]\d{4}[\-\s]?\d{5})(?!\d)")
    phone_ctx = ["phone", "mobile", "contact", "tel", "cell", "call", "ph:", "mob"]
    for m in phone_pattern.finditer(page_text):
        s, e = m.start(1), m.end(1)
        if any(not (e <= a_s or s >= a_e) for a_s, a_e in aadhaar_spans):
            continue
        has_ctx = _has_context(text_lower, s, e, phone_ctx)
        has_plus91 = m.group(1).strip().startswith("+91")
        if has_ctx or has_plus91:
            results.append(RawDetection(
                entity_type="IN_PHONE",
                start=s,
                end=e,
                raw_value=m.group(1),
                confidence=0.92 if (has_ctx and has_plus91) else 0.84,
                detector_name="custom_in_phone",
                page_number=page_number,
            ))

    # 10. BANK_ACCOUNT: 9-18 digits ONLY when near context words like "account", "a/c", "acct", "bank"
    bank_pattern = re.compile(r"(?<!\d)(\d{9,18})(?!\d)")
    bank_ctx = ["account", "a/c", "acct", "bank", "iban", "beneficiary", "savings", "current a/c"]
    for m in bank_pattern.finditer(page_text):
        s, e = m.start(1), m.end(1)
        if any(not (e <= a_s or s >= a_e) for a_s, a_e in aadhaar_spans):
            continue
        if _has_context(text_lower, s, e, bank_ctx, window=60):
            results.append(RawDetection(
                entity_type="BANK_ACCOUNT",
                start=s,
                end=e,
                raw_value=m.group(1),
                confidence=0.88,
                detector_name="custom_bank_account",
                page_number=page_number,
            ))

    # 11. CREDIT_CARD: 13-19 digits with valid Luhn checksum
    cc_pattern = re.compile(r"(?<!\d)(\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{1,7})(?!\d)")
    for m in cc_pattern.finditer(page_text):
        s, e = m.start(1), m.end(1)
        if any(not (e <= a_s or s >= a_e) for a_s, a_e in aadhaar_spans):
            continue
        candidate = m.group(1)
        if luhn_validate(candidate):
            results.append(RawDetection(
                entity_type="CREDIT_CARD",
                start=s,
                end=e,
                raw_value=candidate,
                confidence=0.95,
                detector_name="custom_credit_card_luhn",
                page_number=page_number,
            ))

    # 12. SECRETS: AWS access keys, private key blocks, JWTs, API keys, password assignments
    aws_pattern = re.compile(r"\b((?:AKIA|ASIA)[0-9A-Z]{16})\b")
    for m in aws_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="SECRETS",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.99,
            detector_name="custom_secret_aws_key",
            page_number=page_number,
        ))

    pk_pattern = re.compile(r"(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]{10,400}?-----END [A-Z0-9 ]*PRIVATE KEY-----|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)")
    for m in pk_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="SECRETS",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.99,
            detector_name="custom_secret_private_key",
            page_number=page_number,
        ))

    jwt_pattern = re.compile(r"\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b")
    for m in jwt_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="SECRETS",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.95,
            detector_name="custom_secret_jwt",
            page_number=page_number,
        ))

    pwd_pattern = re.compile(
        r"((?:password|passwd|pwd|db_password|db_pass|api_key|apikey|secret_key|client_secret|access_token)\s*[:=]\s*['\"]?[^\s'\",;\n]{6,64}['\"]?)",
        re.IGNORECASE,
    )
    for m in pwd_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="SECRETS",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.94,
            detector_name="custom_secret_assignment",
            page_number=page_number,
        ))

    # 13. MEDICAL_LICENSE & HEALTH_TERM
    med_lic_pattern = re.compile(
        r"\b((?:MCI|NMC|KMC|MMC|DMC|DR-REG|MED-LIC)[-\s/]?[0-9]{4,10})\b",
        re.IGNORECASE,
    )
    for m in med_lic_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="MEDICAL_LICENSE",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.91,
            detector_name="custom_medical_license",
            page_number=page_number,
        ))

    health_terms_pattern = re.compile(
        r"\b(Type\s*2\s*Diabetes\s*Mellitus|Essential\s*Hypertension|Acute\s*Myocardial\s*Infarction|"
        r"Chronic\s*Kidney\s*Disease|Bronchial\s*Asthma|ICD-10\s*[A-Z]\d{2}(?:\.\d+)?|"
        r"Metformin\s*\d+\s*mg|Amlodipine\s*\d+\s*mg|Atorvastatin\s*\d+\s*mg|Discharge\s*Diagnosis)\b",
        re.IGNORECASE,
    )
    for m in health_terms_pattern.finditer(page_text):
        results.append(RawDetection(
            entity_type="HEALTH_TERM",
            start=m.start(1),
            end=m.end(1),
            raw_value=m.group(1),
            confidence=0.88,
            detector_name="custom_health_classifier",
            page_number=page_number,
        ))

    # 14. EMAIL_ADDRESS (deterministic regex alongside Presidio)
    email_pattern = re.compile(r"\b([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\b")
    for m in email_pattern.finditer(page_text):
        val = m.group(1)
        # Skip if already matched as UPI
        if any(r.entity_type == "IN_UPI_ID" and r.start == m.start(1) for r in results):
            continue
        results.append(RawDetection(
            entity_type="EMAIL_ADDRESS",
            start=m.start(1),
            end=m.end(1),
            raw_value=val,
            confidence=0.95,
            detector_name="presidio_email_recognizer",
            page_number=page_number,
        ))

    return results


# ==============================================================================
# 4. DOCUMENT-LEVEL CLASSIFIERS & EXPLICIT MARKINGS (Layer 3)
# ==============================================================================
DOCUMENT_CATEGORY_KEYWORDS: Dict[str, List[Tuple[str, float]]] = {
    "FINANCIAL": [
        ("salary", 2.0), ("ctc", 2.5), ("payroll", 2.5), ("bank account", 2.0),
        ("invoice amount", 2.0), ("net pay", 2.0), ("gross pay", 2.0), ("remittance", 1.5),
        ("gstin", 2.0), ("ifsc", 1.5), ("taxable value", 2.0),
    ],
    "HEALTH": [
        ("diagnosis", 3.0), ("prescription", 3.0), ("patient", 2.5), ("discharge summary", 3.0),
        ("icd-10", 3.0), ("icd", 2.0), ("dosage", 2.0), ("clinical", 1.5), ("doctor registration", 2.5),
    ],
    "LEGAL": [
        ("non-disclosure", 2.5), ("confidential agreement", 2.5), ("litigation", 2.5),
        ("indemnity", 2.0), ("arbitration", 2.0), ("master supply agreement", 2.0),
    ],
    "HR": [
        ("employee master", 3.0), ("performance review", 2.5), ("termination", 2.5),
        ("appraisal", 2.0), ("compensation ledger", 2.5), ("employee id", 2.0),
    ],
    "CREDENTIALS": [
        ("private key", 4.0), ("aws_access_key", 4.0), ("db_password", 4.0),
        ("api_key", 3.0), ("secret_key", 3.5), ("production credentials", 4.0),
    ],
}

EXPLICIT_MARKINGS = [
    "strictly confidential",
    "confidential",
    "internal only",
    "restricted",
    "do not distribute",
    "proprietary",
]


def classify_document_text(full_text: str) -> Dict[str, Any]:
    """
    Evaluates document-level classifiers (FINANCIAL, HEALTH, LEGAL, HR, CREDENTIALS)
    and checks for explicit confidentiality markings.
    """
    text_lower = full_text.lower()
    category_scores: Dict[str, float] = {}
    matched_keywords: Dict[str, List[str]] = {}

    for cat, kw_list in DOCUMENT_CATEGORY_KEYWORDS.items():
        score = 0.0
        matched = []
        for kw, weight in kw_list:
            if kw in text_lower:
                score += weight
                matched.append(kw)
        if score > 0:
            category_scores[cat] = min(10.0, round(score, 2))
            matched_keywords[cat] = matched

    markings_found = [m for m in EXPLICIT_MARKINGS if m in text_lower]

    dominant_category = None
    max_cat_bonus = 0.0
    if category_scores:
        dominant_category = max(category_scores, key=category_scores.get)
        max_cat_bonus = min(10.0, category_scores[dominant_category])

    return {
        "category_scores": category_scores,
        "matched_keywords": matched_keywords,
        "dominant_category": dominant_category,
        "category_bonus": round(max_cat_bonus, 1),
        "markings_found": markings_found,
        "has_explicit_marking": len(markings_found) > 0,
        "marking_bonus": 5.0 if markings_found else 0.0,
    }
