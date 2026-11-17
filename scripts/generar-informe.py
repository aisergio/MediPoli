"""Genera un informe Word a partir de sus páginas Markdown y figuras Mermaid."""
import argparse
import json
import re
from pathlib import Path

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image


INK = "20262E"
BLUE = "143D60"
MUTED = "475A6B"


def element(name, **attributes):
    node = OxmlElement("w:" + name)
    for key, value in attributes.items():
        node.set(qn("w:" + key), str(value))
    return node


def add_style(document, name, size, color=INK, family="Arial", italic=False):
    style = document.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    style.base_style = document.styles["Normal"]
    style.font.name = family
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor.from_string(color)
    style.font.italic = italic
    return style


def format_document(document, title, label):
    section = document.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.left_margin = Inches(.85)
    section.right_margin = Inches(.85)
    section.top_margin = Inches(.8)
    section.bottom_margin = Inches(.75)
    section.header_distance = Inches(.35)
    section.footer_distance = Inches(.35)

    normal = document.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_after = Pt(9)
    normal.paragraph_format.line_spacing = 1.15
    normal._element.get_or_add_rPr().append(element("lang", val="es-CO"))
    for name, size, before in [("Title", 27, 0), ("Heading 1", 20, 0), ("Heading 2", 14, 13), ("Heading 3", 12, 10)]:
        style = document.styles[name]
        style.font.name = "Arial"
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor.from_string("000000")
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(9)
        style.paragraph_format.keep_with_next = True
        for border in style._element.xpath(".//w:pBdr"):
            border.getparent().remove(border)
    caption = add_style(document, "Pie de figura MediPoli", 9, MUTED, italic=True)
    caption.paragraph_format.space_after = Pt(11)
    code = add_style(document, "Código MediPoli", 9, BLUE, "Consolas")
    code.paragraph_format.space_after = Pt(9)
    code.paragraph_format.line_spacing = 1.05
    code.paragraph_format.keep_together = True
    code.paragraph_format.left_indent = Inches(.12)
    cell = add_style(document, "Celda MediPoli", 9.3)
    cell.paragraph_format.space_after = Pt(0)
    cell.paragraph_format.line_spacing = 1.08

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = footer.add_run(label + "  /  ")
    run.font.size = Pt(8)
    run.font.color.rgb = RGBColor.from_string(MUTED)
    run._r.append(element("fldSimple", instr="PAGE"))
    document.core_properties.title = title
    document.core_properties.subject = label
    document.core_properties.author = "Proyecto MediPoli"
    document.core_properties.last_modified_by = "Proyecto MediPoli"
    document.core_properties.comments = ""


def rich_text(paragraph, text):
    for part in re.split(r"(\*\*[^*]+\*\*|\x60[^\x60]+\x60)", text):
        if not part:
            continue
        if part.startswith("**"):
            paragraph.add_run(part[2:-2]).bold = True
        elif part.startswith("`"):
            run = paragraph.add_run(part[1:-1])
            run.font.name = "Consolas"
            run.font.size = Pt(10)
        else:
            paragraph.add_run(part)


def add_table(document, rows):
    columns = len(rows[0])
    total_inches = 6.8
    ratios = {
        2: (.34, .66),
        3: (.28, .31, .41),
        4: (.22, .25, .26, .27),
    }.get(columns, tuple([1 / columns] * columns))
    table = document.add_table(rows=0, cols=columns)
    table.autofit = False
    properties = table._tbl.tblPr
    borders = element("tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        borders.append(element(side, val="single", sz=5, color="D9D9D9"))
    properties.append(borders)
    margins = element("tblCellMar")
    for side in ("top", "bottom", "left", "right"):
        margins.append(element(side, w=85, type="dxa"))
    properties.append(margins)
    for index, ratio in enumerate(ratios):
        table.columns[index].width = Inches(total_inches * ratio)
    for row_number, row_text in enumerate(rows):
        row = table.add_row()
        row_props = row._tr.get_or_add_trPr()
        row_props.append(element("cantSplit"))
        if row_number == 0:
            row_props.append(element("tblHeader"))
        for index, (cell, text) in enumerate(zip(row.cells, row_text, strict=True)):
            cell.width = Inches(total_inches * ratios[index])
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            shade = BLUE if row_number == 0 else ("F1F6FA" if row_number % 2 == 0 else "FFFFFF")
            cell._tc.get_or_add_tcPr().append(element("shd", fill=shade))
            paragraph = cell.paragraphs[0]
            paragraph.style = document.styles["Celda MediPoli"]
            rich_text(paragraph, text)
            if row_number == 0:
                for run in paragraph.runs:
                    run.bold = True
                    run.font.color.rgb = RGBColor.from_string("FFFFFF")
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(0)
    paragraph.paragraph_format.line_spacing = 1
    paragraph.add_run(" ").font.size = Pt(4)


def add_figure(document, image_path, description):
    with Image.open(image_path) as picture:
        width, height = picture.size
    display_width = min(6.8, (width / height) * 3.65)
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.keep_with_next = True
    paragraph.paragraph_format.space_after = Pt(3)
    shape = paragraph.add_run().add_picture(str(image_path), width=Inches(display_width))
    shape._inline.docPr.set("descr", description)


def table_row(line):
    return [part.strip() for part in line.strip().strip("|").split("|")]


def add_page(document, page, figures, first):
    lines = page.strip().splitlines()
    current = 0
    while current < len(lines):
        line = lines[current].strip()
        current += 1
        if not line:
            continue
        if line.startswith("#"):
            marks, text = line.split(" ", maxsplit=1)
            style_name = "Title" if first and marks == "#" else f"Heading {len(marks)}"
            document.add_paragraph(text, style_name)
            continue
        if line.startswith("|"):
            rows = [table_row(line)]
            while current < len(lines) and lines[current].strip().startswith("|"):
                candidate = table_row(lines[current])
                if not all(re.fullmatch(r":?-+:?", value) for value in candidate):
                    rows.append(candidate)
                current += 1
            add_table(document, rows)
            continue
        if line.startswith("```"):
            code_lines = []
            while current < len(lines) and not lines[current].startswith("```"):
                code_lines.append(lines[current])
                current += 1
            current += 1
            document.add_paragraph("\n".join(code_lines), "Código MediPoli")
            continue
        figure = re.fullmatch(r"!\[([^]]+)\]\(([A-Za-z0-9-]+)\)", line)
        if figure:
            add_figure(document, figures / (figure[2] + ".png"), figure[1])
            continue
        if line.startswith("Figura "):
            document.add_paragraph(line, "Pie de figura MediPoli")
            continue
        if line.startswith("- "):
            rich_text(document.add_paragraph(style="List Bullet"), line[2:])
            continue
        paragraph = document.add_paragraph()
        rich_text(paragraph, line)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--figures", required=True, type=Path)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--label", default="MediPoli · Unidad 2")
    args = parser.parse_args()
    text = args.source.read_text(encoding="utf-8")
    evidence = json.loads(args.evidence.read_text(encoding="utf-8-sig")) if args.evidence else {}
    text = re.sub(r"\{\{([a-z]+)\}\}", lambda match: evidence.get(match[1], "Pendiente de ejecución"), text)
    pages = text.split("<!-- page -->")
    document = Document()
    format_document(document, pages[0].strip().splitlines()[0].lstrip("# "), args.label)
    for index, page in enumerate(pages):
        if index:
            document.add_page_break()
        add_page(document, page, args.figures, index == 0)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    document.save(args.output)


if __name__ == "__main__":
    main()
