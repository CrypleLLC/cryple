#!/usr/bin/env python3
"""Fails the build when inheritance or guardian recovery comes back, and when a
markdown link or heading anchor stops resolving.

Run from the repository root:  python3 scripts/separation-gate.py

Two independent checks, and they are deliberately asymmetric. See
.docs/tasks/tasks.md, Task 99, for why.
"""

import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SKIP_DIRS = {".git", "node_modules", ".next", "dist", "build", ".turbo", "vendor", ".claude"}
SOURCE_SUFFIXES = {".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".sql", ".yml", ".yaml", ".sh"}

# Files whose whole job is to record what left. Prose is allowed to name the
# removed features; source code is not. Keep this list short and justified.
PROSE_ALLOWLIST = {
    ".docs/tasks/tasks.md",
}

# Source-code vocabulary. A match here means the feature is being rebuilt.
#
# NOT in this list, and never to be added: pqxdh, x25519, ml-kem, mlkem,
# user_keys, and the bare word "share". They are product vocabulary that
# private sharing (Task 102) is built from, and a gate that flags them would
# fail the feature this repository is keeping.
BANNED = {
    "heir": r"\bheirs?\b",
    "beneficiary": r"\bbeneficiar(y|ies)\b",
    "succession": r"\bsuccession\b",
    "inheritance": r"\binheritance\b",
    "dead man's switch": r"dead[ _-]?man",
    "DeadManSwitch": r"DeadManSwitch",
    "Merkle": r"\bmerkle\b",
    "ProofRegistry": r"proof[ _-]?registry",
    "smart account": r"smart[ _-]?account",
    "userOp": r"\buserops?\b",
    "paymaster": r"\bpaymasters?\b",
    "guardian": r"\bguardians?\b",
    "Shamir": r"\bshamir\b",
    "REK": r"\bREK\b",
    "recovery kit": r"recovery[ _-]?kit",
    "recovery/succession/pin-reset route": r"/(recovery|succession)/|/auth/pin-reset",
    "retired table": r"\b(recovery_vaults|recovery_shares|recovery_sessions|recovery_session_shares|pin_reset_requests|pin_reset_votes|guardians|beneficiaries|inheritance_shares|vault_anchor_leaves)\b",
    "retired signed action": r"\b(guardian-invite|guardian-accept|guardian-revoke|recovery-setup|recovery-share-submit|pin-reset-request|pin-reset-vote|pin-reset-revoke|pin-reset-confirm|beneficiary-register|beneficiary-delete|share-assign|share-delete|succession-release-vote)\b",
}

CASE_SENSITIVE = {"REK", "DeadManSwitch"}

# Calibrated false positives. Each one is a real, unrelated use of a banned
# word; anything added here must name why.
EXEMPT_LINE = [
    r"anchorNode|anchorOffset|getSelection",   # DOM Selection API, not a proof anchor
    r'"moduleResolution"',                     # tsconfig "bundler"
    r"dms-shamir",                             # the fork's name contains "shamir"
    r"separation-gate",                        # this file names what it bans
]


def iter_files(suffixes=None):
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if suffixes is not None and path.suffix not in suffixes:
            continue
        yield path


def check_source() -> list[str]:
    failures = []
    for path in iter_files(SOURCE_SUFFIXES):
        rel = path.relative_to(ROOT).as_posix()
        if rel.endswith("package-lock.json"):
            continue
        try:
            lines = path.read_text().splitlines()
        except (UnicodeDecodeError, OSError):
            continue
        for number, line in enumerate(lines, 1):
            if any(re.search(exempt, line) for exempt in EXEMPT_LINE):
                continue
            for label, pattern in BANNED.items():
                flags = 0 if label in CASE_SENSITIVE else re.IGNORECASE
                if re.search(pattern, line, flags):
                    failures.append(f"{rel}:{number}  [{label}]  {line.strip()[:110]}")
    return failures


def slugify(heading: str) -> str:
    """GitHub's heading-anchor rule: strip markup, lowercase, drop anything that
    is not a word character, space or hyphen, then turn spaces into hyphens.

    Runs of hyphens are collapsed at comparison time rather than here. GitHub
    and this function disagree on how many hyphens an emoji leaves behind, and
    a link checker that reports a phantom failure is one people switch off.
    """
    heading = re.sub(r"<[^>]+>", "", heading)
    heading = heading.replace("`", "").replace("*", "")
    heading = unicodedata.normalize("NFKD", heading)
    heading = "".join(c for c in heading if not unicodedata.combining(c))
    heading = re.sub(r"[^\w\s-]", "", heading.lower())
    return heading.strip().replace(" ", "-")


def normalize_anchor(anchor: str) -> str:
    return re.sub(r"-+", "-", anchor).strip("-")


def anchors_of(text: str) -> set[str]:
    found = {normalize_anchor(slugify(h)) for h in re.findall(r"^#{1,6}\s+(.*?)\s*$", text, re.MULTILINE)}
    found |= {normalize_anchor(a) for a in re.findall(r'<a\s+id="([^"]+)"', text)}
    return found


def check_links() -> list[str]:
    failures = []
    for path in iter_files({".md"}):
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text()
        for match in re.finditer(r"\]\((?!https?:|mailto:)([^)#]*)(?:#([^)]+))?\)", text):
            target_path, anchor = match.group(1), match.group(2)
            if not target_path and not anchor:
                continue
            target = path if not target_path else (path.parent / target_path)
            if not target.exists():
                failures.append(f"{rel}  broken link -> {target_path}")
                continue
            if anchor and target.suffix == ".md" and normalize_anchor(anchor) not in anchors_of(target.read_text()):
                failures.append(f"{rel}  broken anchor -> {target_path}#{anchor}")
    return failures


def main() -> int:
    source = check_source()
    links = check_links()

    if source:
        print(f"\nInheritance or guardian vocabulary in source ({len(source)}):\n")
        for failure in source:
            print(f"  {failure}")
        print("\n  These features left the product on 2026-09-03 and 2026-09-04 and live in")
        print("  dms-shamir. See .docs/tasks/tasks.md, Tasks 93-96.")

    if links:
        print(f"\nBroken markdown links or anchors ({len(links)}):\n")
        for failure in links:
            print(f"  {failure}")

    if source or links:
        return 1

    print("separation gate: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
