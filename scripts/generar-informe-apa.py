"""Compone las entregas MediPoli sobre la plantilla institucional de Word."""
import argparse
import io
import json
import re
from copy import deepcopy
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from PIL import Image
from pypdf import PdfReader


def tag(name, **attributes):
    item = OxmlElement("w:" + name)
    for key, value in attributes.items():
        item.set(qn("w:" + key), str(value))
    return item


def fill(xml, value):
    texts = xml.xpath(".//w:t")
    if texts:
        texts[0].text = value
        for later in texts[1:]:
            later.text = ""
        return
    r = tag("r")
    t = tag("t")
    t.text = value
    r.append(t)
    xml.append(r)


def replacement(entry, label, page):
    result = deepcopy(entry)
    for key in list(result.attrib):
        if key.endswith(("paraId", "textId")):
            del result.attrib[key]
    values = result.xpath(".//w:t")
    values[0].text = label
    values[-1].text = str(page)
    return result


def normalize(value):
    return " ".join(value.replace("\u00ad", "").replace("\u200b", "").split())


def find_page(pages, label):
    if not pages:
        return "—"
    needle = normalize(label)
    body_started = False
    for i, body in enumerate(pages, start=1):
        lines = {normalize(line) for line in body.splitlines()}
        body_started = body_started or "Introducción" in lines
        if body_started and needle in lines:
            return i
    return "—"


def line_text(paragraph, text):
    for part in re.split(r"(\*\*[^*]+\*\*|\x60[^\x60]+\x60)", text):
        if not part:
            continue
        if part.startswith("**"):
            paragraph.add_run(part[2:-2]).bold = True
        else:
            run = paragraph.add_run(part[1:-1] if part.startswith("\x60") else part)
            if part.startswith("\x60"):
                run.font.name = "Consolas"
                run.font.size = Pt(10)


def simple(document, text, bold=False, italic=False, center=False, keep=False):
    paragraph = document.add_paragraph(style="No Spacing")
    paragraph.paragraph_format.first_line_indent = Inches(0)
    paragraph.paragraph_format.line_spacing = 1.15
    paragraph.paragraph_format.space_after = Pt(5)
    paragraph.paragraph_format.keep_with_next = keep
    if center:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run(text)
    run.bold, run.italic = bold, italic
    return paragraph


def apa_title(document, label, title):
    simple(document, label, bold=True, keep=True)
    simple(document, title, italic=True, keep=True)


def table_rows(lines, at):
    rows = []
    while at < len(lines) and lines[at].lstrip().startswith("|"):
        cells = [cell.strip() for cell in lines[at].strip().strip("|").split("|")]
        if not all(re.fullmatch(r":?-+:?", cell) for cell in cells):
            rows.append(cells)
        at += 1
    return rows, at


def apa_table(document, rows):
    columns = len(rows[0])
    width = 6.5
    ratio = {2: (.35,.65), 3: (.26,.37,.37), 4: (.24,.24,.25,.27)}.get(columns, [1 / columns] * columns)
    table = document.add_table(rows=0, cols=columns)
    table.style = "Normal Table"
    table.autofit = False
    rules = tag("tblBorders")
    for side in ("top", "bottom"):
        rules.append(tag(side, val="single", sz=9, color="000000"))
    for side in ("left", "right", "insideH", "insideV"):
        rules.append(tag(side, val="nil"))
    table._tbl.tblPr.append(rules)
    pads = tag("tblCellMar")
    for side in ("top", "bottom", "left", "right"):
        pads.append(tag(side, w=85, type="dxa"))
    table._tbl.tblPr.append(pads)
    for column, share in zip(table.columns, ratio):
        column.width = Inches(width * share)
    for row_number, items in enumerate(rows):
        row = table.add_row()
        row._tr.get_or_add_trPr().append(tag("cantSplit"))
        if row_number == 0:
            row._tr.get_or_add_trPr().append(tag("tblHeader"))
        for cell, content, share in zip(row.cells, items, ratio, strict=True):
            cell.width = Inches(width * share)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            par = cell.paragraphs[0]
            par.paragraph_format.first_line_indent = Inches(0)
            line_text(par, content)
            for run in par.runs:
                run.font.size = Pt(11)
                if row_number == 0:
                    run.bold = True
            if row_number == 0:
                border = tag("tcBorders")
                border.append(tag("bottom", val="single", sz=8, color="000000"))
                cell._tc.get_or_add_tcPr().append(border)
    simple(document, "", keep=False).paragraph_format.space_after = Pt(4)


def add_image(document, image_path, text):
    with Image.open(image_path) as img:
        width, height = img.size
    para = document.add_paragraph()
    para.paragraph_format.first_line_indent = Inches(0)
    para.paragraph_format.keep_with_next = True
    para.paragraph_format.space_after = Pt(5)
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    display = min(6.45, width / height * 5.15)
    picture = para.add_run().add_picture(str(image_path), width=Inches(display))
    picture._inline.docPr.set("descr", text)


def mark_heading(document, title, level, new_page=False):
    paragraph = document.add_paragraph(title, "Heading " + str(level))
    paragraph.paragraph_format.keep_with_next = True
    paragraph.paragraph_format.page_break_before = new_page
    paragraph.paragraph_format.space_before = Pt(11)
    paragraph.paragraph_format.space_after = Pt(7)
    return paragraph


def make_body(document, pages, figures, abstract):
    title_records, fig_records, table_records = [], [], []
    preface = abstract.get("intro")
    if preface:
        title_records.append("Introducción")
        mark_heading(document, "Introducción", 1)
        document.add_paragraph(preface)
        mark_heading(document, "Objetivos", 2)
        for statement in abstract["objectives"]:
            document.add_paragraph(statement)
    table_count = 0
    chosen_breaks = {"Componentes de la arquitectura", "Identidad y autorización", "Estructura y estado de Terraform",
        "Verificación del aprovisionamiento", "Flujo de automatización", "Decisiones y riesgos técnicos", "Referencias"}
    for page in pages:
        lines = page.strip().splitlines()
        title = lines[0].lstrip("# ") if lines else ""
        at = 0
        while at < len(lines):
            text = lines[at].strip()
            at += 1
            if not text:
                continue
            if text.startswith("#"):
                head, value = text.split(" ", maxsplit=1)
                if head == "#":
                    title_records.append(value)
                mark_heading(document, value, len(head), head == "#" and value in chosen_breaks)
                continue
            if text.startswith("|"):
                rows, at = table_rows(lines, at - 1)
                table_count += 1
                label = f"Tabla {table_count}"
                name = {
                    "ID": "Requisitos funcionales y criterios de aceptación",
                    "Requisito": "Requisitos no funcionales",
                    "Actor": "Acciones por rol y verificaciones negativas",
                    "Identidad": "Permisos de las identidades de MediPoli",
                    "Ubicación": "Estructura y estados de la infraestructura",
                    "Control": "Resultados de verificación" if "Estado de evidencia" in rows[0] else "Controles de consumo",
                    "Servicio": "Escenario mensual de consumo AWS",
                    "Alternativa de entrega": "Alternativas de automatización",
                    "Rúbrica U2": "Correspondencia entre rúbrica y evidencias"
                }.get(rows[0][0], title)
                apa_title(document, label, name)
                table_records.append((label, name))
                apa_table(document, rows)
                continue
            if text.startswith("\x60\x60\x60"):
                code = []
                while at < len(lines) and not lines[at].startswith("\x60\x60\x60"):
                    code.append(lines[at])
                    at += 1
                at += 1
                para = document.add_paragraph()
                para.paragraph_format.first_line_indent = Inches(0)
                para.paragraph_format.keep_together = True
                para.paragraph_format.space_before = Pt(6)
                para.paragraph_format.space_after = Pt(6)
                run = para.add_run("\n".join(code))
                run.font.name = "Consolas"
                run.font.size = Pt(9)
                continue
            image = re.fullmatch(r"!\[([^]]+)\]\(([A-Za-z0-9-]+)\)", text)
            if image:
                label = f"Figura {len(fig_records) + 1}"
                name = image[1]
                fig_records.append((label, name))
                apa_title(document, label, name)
                add_image(document, figures / (image[2] + ".png"), name)
                continue
            if re.match(r"Figura \d+\.", text):
                description = re.sub(r"^Figura \d+\.\s*", "", text)
                simple(document, "Nota. " + description + " Elaboración propia.", italic=True)
                continue
            if title == "Referencias":
                para = document.add_paragraph(style="Bibliography")
                para.paragraph_format.space_after = Pt(7)
                match = re.match(r"^(.*?\)\. )(.+?)(\. .+)$", text)
                if match:
                    para.add_run(match[1])
                    para.add_run(match[2]).italic = True
                    para.add_run(match[3])
                else:
                    para.add_run(text)
                continue
            para = document.add_paragraph()
            para.paragraph_format.space_after = Pt(6)
            line_text(para, text)
    return title_records, fig_records, table_records


def insert_front_lists(document, control, entry, tables, figures, reference_pages):
    container = control.find(qn("w:sdtContent"))
    for item in list(container)[1:]:
        container.remove(item)
    for title in tables:
        container.append(replacement(entry, title, find_page(reference_pages, title)))
    control.addnext(document.add_page_break()._p)
    last = control.getnext()
    for heading, records in figures:
        section = simple(document, heading, bold=True, center=True, keep=True)
        last.addnext(section._p)
        last = section._p
        for label, name in records:
            item = replacement(entry, label + "  " + name, find_page(reference_pages, label))
            for prop in item.xpath("./w:pPr/w:spacing"):
                prop.set(qn("w:line"), "290")
            last.addnext(item)
            last = item
    last.addnext(document.add_page_break()._p)


def save_preserving_parts(document, reference, output):
    tmp = io.BytesIO()
    document.save(tmp)
    tmp.seek(0)
    with ZipFile(reference) as original, ZipFile(tmp) as built, ZipFile(output, "w", ZIP_DEFLATED) as result:
        editable = {"word/document.xml", "word/_rels/document.xml.rels", "docProps/core.xml", "[Content_Types].xml"}
        original_names = set(original.namelist())
        for path in original.namelist():
            result.writestr(path, built.read(path) if path in editable else original.read(path))
        for path in built.namelist():
            if path not in original_names:
                result.writestr(path, built.read(path))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--template", required=True, type=Path)
    parser.add_argument("--figures", required=True, type=Path)
    parser.add_argument("--summary", required=True, type=Path)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--map-pdf", type=Path)
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text(encoding="utf-8-sig")) if args.evidence else {}
    abstract = json.loads(args.summary.read_text(encoding="utf-8-sig"))
    text = args.source.read_text(encoding="utf-8")
    text = re.sub(r"\{\{([a-z]+)\}\}", lambda m: evidence.get(m[1], "Pendiente de ejecución"), text)
    source = Document(args.template)
    elements = list(source._element.body)
    control = elements[39]
    assert len(source.sections) == 1 and control.tag == qn("w:sdt")
    entry = deepcopy(control.find(qn("w:sdtContent"))[1])
    fill(elements[0], abstract["title"])
    fill(elements[24], abstract["es"])
    fill(elements[27], "Palabras clave: " + abstract["keywords"])
    fill(elements[32], abstract["en"])
    fill(elements[35], "Keywords: " + abstract["keyWords"])
    # Quitar solo los ejemplos del cuerpo y de las listas. El índice conserva su control original.
    for item in elements[40:-1]:
        source._element.body.remove(item)
    parts = text.split("<!-- page -->")[1:]
    headings, figures, tables = make_body(source, parts, args.figures, abstract)
    pdf_text = [p.extract_text() or "" for p in PdfReader(args.map_pdf).pages] if args.map_pdf else []
    insert_front_lists(source, control, entry, headings, [("Lista de Tablas", tables), ("Lista de Figuras", figures)], pdf_text)
    source.core_properties.title = abstract["title"]
    source.core_properties.subject = abstract.get("label", "MediPoli")
    source.core_properties.comments = ""
    args.output.parent.mkdir(parents=True, exist_ok=True)
    save_preserving_parts(source, args.template, args.output)
    print(json.dumps({"headings": headings, "figures": len(figures), "tables": len(tables),
      "toc": {name:find_page(pdf_text, name) for name in headings}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
