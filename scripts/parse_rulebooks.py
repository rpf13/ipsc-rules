"""Parse the IPSC rulebook PDFs into structured, citable chunks.

Usage: python scripts/parse_rulebooks.py   (reads public/pdf/*.pdf, writes data/chunks.json)

Each chunk is one numbered rule (e.g. 5.1.3), one section intro, or one appendix
item / table row, carrying discipline, edition, chapter, section and page metadata.
"""

import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "public" / "pdf"
OUT = ROOT / "data" / "chunks.json"

DISCIPLINES = {
    "handgun": {"name": "Handgun", "prefix": "hg"},
    "shotgun": {"name": "Shotgun", "prefix": "sg"},
    "rifle": {"name": "Rifle", "prefix": "rf"},
    "pcc": {"name": "Pistol Caliber Carbine", "prefix": "pcc"},
}

CHAPTER_RE = re.compile(r"^CHAPTER (\d+):\s+(.+)$")
APPENDIX_RE = re.compile(r"^APPENDIX ([A-Z]\d*[a-z]?):\s*(.+)$")
RULE_RE = re.compile(r"^(\d{1,2}(?:\.\d{1,2})+)$")
ITEM_RE = re.compile(r"^(\d{1,2}(?:\.\d{1,2})?)\.?$")
HEADER_RE = re.compile(r"^IPSC .+ Rules, .+ Edition$")
EDITION_RE = re.compile(r"([A-Z]+\s+\d{4})\s+EDITION", re.I)


def clean(s):
    s = s.replace(" ", " ").replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"[ \t]+", " ", s).strip()


def page_lines(page, exclude_boxes=()):
    """Return the page's text lines in reading order, skipping lines inside exclude_boxes."""
    out = []
    for block in page.get_text("dict", sort=True)["blocks"]:
        for line in block.get("lines", []):
            x0, y0, x1, y1 = line["bbox"]
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            if any(b[0] <= cx <= b[2] and b[1] <= cy <= b[3] for b in exclude_boxes):
                continue
            text = clean("".join(span["text"] for span in line["spans"]))
            out.append(text)
    return out


def strip_header(lines):
    """Remove the running header ('IPSC Handgun Rules, January 2026 Edition') and printed page number."""
    printed = None
    for i, line in enumerate(lines):
        if HEADER_RE.match(line):
            if i + 1 < len(lines) and re.fullmatch(r"[0-9]+|[ivx]+", lines[i + 1]):
                printed = lines[i + 1]
                del lines[i : i + 2]
            else:
                del lines[i]
            break
    while lines and not lines[0]:
        lines.pop(0)
    return printed, lines


def cell_text(page, rect):
    if rect is None:
        return None
    return clean(page.get_text("text", clip=pymupdf.Rect(rect)).replace("\n", " "))


def extract_tables(page):
    """Detect multi-column tables (division tables etc.) and return (rows, bboxes).

    Each row is a list of cell strings; merged cells (None) inherit the value to their left.
    """
    tables, boxes = [], []
    for t in page.find_tables().tables:
        if t.col_count < 3 or t.row_count < 2:
            continue
        rows = []
        for r in t.rows:
            cells = [cell_text(page, c) for c in r.cells]
            rows.append(cells)
        tables.append(rows)
        boxes.append(tuple(t.bbox))
    return tables, boxes


NUM_CELL_RE = re.compile(r"^(\d{1,2}(?:\.\d{1,2})?)\s?\.?$")
NUM_LABEL_RE = re.compile(r"^(\d{1,2}(?:\.\d{1,2})?)\.\s+(.+)$")


def split_item(row):
    """Return (num, label, values) for a numbered table row, or None."""
    first = (row[0] or "").strip()
    if (m := NUM_CELL_RE.match(first)) and len(row) >= 3 and re.search(r"[A-Za-z]", row[1] or ""):
        return m.group(1), row[1], row[2:]
    if m := NUM_LABEL_RE.match(first):
        return m.group(1), m.group(2), row[1:]
    return None


def table_chunks(rows):
    """Turn a table into chunks.

    Numbered tables (division tables etc.) give one chunk per row:
    'Label: Col A: value; Col B: value'. Merged cells (None) take the value to their left.
    Other tables become a single chunk with ' | ' separated rows.
    Returns a list of (num, label, body).
    """
    header = None if split_item(rows[0]) else rows[0]
    body_rows = rows[1:] if header else rows
    items = [split_item(r) for r in body_rows]
    if sum(1 for i in items if i) < max(1, len(body_rows) // 2):
        text = "\n".join(" | ".join(c or "" for c in r) for r in rows if any(r))
        return [(None, None, text)]

    results = []
    for row, item in zip(body_rows, items):
        if not item:
            continue
        num, label, values = item
        names = []
        if header:
            last = None
            for c in header[len(header) - len(values):]:
                last = c or last
                names.append(last or "")
        filled, prev = [], None
        for c in values:
            c = prev if c is None or c == "" else c
            filled.append(c or "")
            prev = c
        if not names or all(not n for n in names):
            body = f"{label}: {' / '.join(dict.fromkeys(v for v in filled if v))}"
        elif len(set(filled)) == 1 and len(filled) > 1:
            body = f"{label}: {filled[0]} (same for: {', '.join(names)})"
        else:
            body = f"{label}: " + "; ".join(f"{n}: {v}" for n, v in zip(names, filled))
        results.append((num, label, body))
    return results


class Builder:
    def __init__(self, key, edition):
        self.key = key
        self.meta = DISCIPLINES[key]
        self.edition = edition
        self.chunks = []
        self.chapter = None  # e.g. "Chapter 5: Competitor Equipment"
        self.chapter_no = None
        self.appendix = None  # e.g. "D6"
        self.section = None  # e.g. "5.1 Firearms"
        self.subheading = None  # appendix sub-heading, e.g. "Open Division"
        self.cur = None
        self.ids = set()

    def uid(self, ref):
        base = f"{self.meta['prefix']}-{ref}".replace(" ", "")
        uid, n = base, 2
        while uid in self.ids:
            uid, n = f"{base}~{n}", n + 1
        self.ids.add(uid)
        return uid

    def flush(self):
        c = self.cur
        self.cur = None
        if not c:
            return
        text = "\n".join(p for p in (clean(" ".join(par)) for par in c.pop("paras")) if p)
        if not text and c["kind"] != "section":
            return
        c["text"] = text
        if c["kind"] == "rule":
            m = re.match(r"^(.{3,70}?) [–-] ", text)
            if m and not m.group(1).endswith("."):
                c["title"] = m.group(1)
            elif len(text) < 50 and not text.endswith("."):
                c["title"] = text.rstrip(":")  # heading-only rule, e.g. "4.3.2 IPSC Poppers"
        if c["kind"] == "section" and not text:
            return  # heading only; rules below carry the section name
        self.chunks.append(c)

    def start(self, kind, ref, label, page, pdf_page, **extra):
        self.flush()
        parent = None
        if kind == "rule":
            parts = ref.split(".")
            for i in range(len(parts) - 1, 1, -1):
                pid = f"{self.meta['prefix']}-{'.'.join(parts[:i])}"
                if pid in self.ids:
                    parent = pid
                    break
        elif kind == "item" and "." in ref.split("#")[-1]:
            pid = f"{self.meta['prefix']}-{ref.rsplit('.', 1)[0]}"
            if pid in self.ids:
                parent = pid
        self.cur = {
            "id": self.uid(ref),
            "d": self.key,
            "kind": kind,
            "ref": ref,
            "label": label,
            "chapter": self.chapter,
            "section": self.subheading if self.appendix else self.section,
            "page": page,
            "pdfPage": pdf_page,
            "paras": [[]],
            **extra,
        }
        if parent:
            self.cur["parent"] = parent

    def add_line(self, line):
        if self.cur is None:
            return
        if not line:
            if self.cur["paras"][-1]:
                self.cur["paras"].append([])
            return
        self.cur["paras"][-1].append(line)

    def set_chapter(self, no, title):
        self.flush()
        self.chapter_no, self.appendix = no, None
        self.chapter = f"Chapter {no}: {title}"
        self.section = None

    def set_appendix(self, code, title):
        self.flush()
        self.chapter_no, self.appendix = None, code
        self.chapter = f"Appendix {code}: {title}"
        self.section = self.subheading = None


def parse(key):
    doc = pymupdf.open(PDF_DIR / f"{key}.pdf")
    m = EDITION_RE.search(doc[0].get_text())
    edition = m.group(1).title() + " Edition" if m else "Unknown Edition"
    b = Builder(key, edition)
    started = False

    for pno in range(doc.page_count):
        page = doc[pno]
        pdf_page = pno + 1
        raw = page.get_text()
        if not started:
            if re.search(r"^CHAPTER 1:\s+\S", raw, re.M) and "...." not in raw:
                started = True
            else:
                continue
        if re.search(r"^\s*INDEX\s*$", raw[:200], re.M):
            break

        tables, boxes = ([], [])
        if b.appendix or re.search(r"^APPENDIX ", raw, re.M):
            tables, boxes = extract_tables(page)

        printed, lines = strip_header(page_lines(page, boxes))
        printed = printed or str(pdf_page)
        lines = [l for l in lines if not HEADER_RE.match(l)]

        # Appendix heading may sit above the table, so handle it before the table rows.
        i = 0
        while i < len(lines) and not lines[i]:
            i += 1
        if i < len(lines) and (am := APPENDIX_RE.match(lines[i])):
            b.set_appendix(am.group(1), am.group(2))
            lines = lines[i + 1 :]

        for rows in tables:
            b.flush()
            for num, label, body in table_chunks(rows):
                if num:
                    b.start("item", f"{b.appendix}#{num}", f"Appendix {b.appendix}, item {num}",
                            printed, pdf_page, title=label)
                else:
                    b.start("table", f"{b.appendix}#table", f"Appendix {b.appendix} (table)", printed, pdf_page)
                for line in body.split("\n"):
                    b.add_line(line)
                    b.add_line("")
            b.flush()

        n = len(lines)
        for idx, line in enumerate(lines):
            if cm := CHAPTER_RE.match(line):
                b.set_chapter(int(cm.group(1)), cm.group(2))
                continue
            if am := APPENDIX_RE.match(line):
                b.set_appendix(am.group(1), am.group(2))
                b.start("text", b.appendix, f"Appendix {b.appendix}", printed, pdf_page)
                continue

            if b.appendix is None and b.chapter_no is not None and (rm := RULE_RE.match(line)):
                ref = rm.group(1)
                if int(ref.split(".")[0]) == b.chapter_no:
                    if ref.count(".") == 1:
                        # Section heading: "6.2" followed by its title line
                        j = idx + 1
                        title = lines[j] if j < n else ""
                        b.section = f"{ref} {title}".strip()
                        b.start("section", ref, f"Section {ref}", printed, pdf_page, title=title)
                        lines[j] = "" if j < n else None
                    else:
                        b.start("rule", ref, f"Rule {ref}", printed, pdf_page)
                    continue

            if b.appendix is not None:
                if im := ITEM_RE.match(line):
                    num = im.group(1)
                    b.start("item", f"{b.appendix}#{num}", f"Appendix {b.appendix}, item {num}", printed, pdf_page)
                    continue
                # Short stand-alone heading line followed by an item number => sub-heading
                prev_blank = idx == 0 or not lines[idx - 1]
                nxt = next((x for x in lines[idx + 1 :] if x), "")
                if (
                    line and prev_blank and len(line) < 60 and not line.endswith((".", ";", ","))
                    and (idx + 1 >= n or not lines[idx + 1]) and ITEM_RE.match(nxt)
                ):
                    b.flush()
                    b.subheading = line.rstrip(":")
                    continue
                if b.cur is None and line:
                    b.start("text", b.appendix, f"Appendix {b.appendix}", printed, pdf_page)

            b.add_line(line)
        # paragraphs never span a page break silently: keep a soft break
        b.add_line("")

    b.flush()
    title = clean(next(l for l in doc[0].get_text().split("\n") if "COMPETITION RULES" in l)).title()
    return {
        "id": key,
        "name": DISCIPLINES[key]["name"],
        "title": f"IPSC {title}",
        "edition": edition,
        "pdf": f"pdf/{key}.pdf",
        "pages": doc.page_count,
    }, b.chunks


LEADER_RE = re.compile(r"\s*\.{4,}\s*")


def split_definitions(chunks):
    """Split glossary-style chunks ('Term ........ Definition') into one chunk per term."""
    out = []
    for c in chunks:
        parts = LEADER_RE.split(c["text"])
        if len(parts) < 5:
            out.append(c)
            continue

        def cut(s):
            # "...end of previous definition. Next Term" -> (definition, term)
            m = re.search(r"^(.*[.:;)\]])\s+((?:\([a-z]\)\s*)?[A-Z(][^.]{0,60})$", s, re.S)
            if not m:
                return "", s
            return re.sub(r"\s*\([a-z]\)$", "", m.group(1)), m.group(2)

        intro, term = cut(parts[0])
        if intro.strip():
            out.append({**c, "text": intro.strip()})
        for i, part in enumerate(parts[1:], 1):
            definition, nxt = cut(part) if i < len(parts) - 1 else (part, None)
            name = re.sub(r"^\([a-z]\)\s*", "", term).strip()
            out.append({
                **c,
                "id": f"{c['id']}:{re.sub(r'[^A-Za-z0-9]+', '-', name).strip('-').lower()}",
                "kind": "definition",
                "label": f"{c['label']} – {name}",
                "title": name,
                "text": f"{name}: {definition.strip()}",
                "parent": c["id"] if intro.strip() else c.get("parent"),
            })
            term = nxt
    return out


def main():
    docs, chunks = [], []
    for key in DISCIPLINES:
        doc, ch = parse(key)
        ch = split_definitions(ch)
        docs.append(doc)
        chunks.extend(ch)
        print(f"{key:8s} {doc['edition']:22s} {len(ch):5d} chunks", file=sys.stderr)
    OUT.write_text(json.dumps({"docs": docs, "chunks": chunks}, ensure_ascii=False, indent=1))
    print(f"wrote {OUT} ({len(chunks)} chunks)", file=sys.stderr)


if __name__ == "__main__":
    main()
