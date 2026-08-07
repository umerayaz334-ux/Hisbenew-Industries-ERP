const sanitizePdfText = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapePdfText = (value) =>
  sanitizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const truncatePdfText = (value, width, fontSize = 7) => {
  const text = sanitizePdfText(value);
  const maxCharacters = Math.max(4, Math.floor(width / (fontSize * 0.52)));
  return text.length > maxCharacters
    ? `${text.slice(0, maxCharacters - 3)}...`
    : text;
};

export const buildPdfDocument = ({ title, subtitle, columns, rows }) => {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 32;
  const tableWidth = pageWidth - margin * 2;
  const fontSize = columns.length > 9 ? 6 : 7;
  const rowHeight = 18;
  const columnWeights = columns.map((column) => column.pdfWidth || 1);
  const totalWeight = columnWeights.reduce((sum, value) => sum + value, 0);
  const columnWidths = columnWeights.map(
    (weight) => (weight / totalWeight) * tableWidth
  );
  const firstPageRows = 22;
  const otherPageRows = 27;
  const pages = [];
  let cursor = 0;

  while (cursor < rows.length || pages.length === 0) {
    const capacity = pages.length === 0 ? firstPageRows : otherPageRows;
    pages.push(rows.slice(cursor, cursor + capacity));
    cursor += capacity;
  }

  const objects = [];
  const addObject = (content = "") => {
    objects.push(content);
    return objects.length;
  };

  const catalogId = addObject();
  const pagesId = addObject();
  const regularFontId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  );
  const boldFontId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  );
  const pageIds = [];

  pages.forEach((pageRows, pageIndex) => {
    const commands = [];
    const addText = (
      text,
      x,
      y,
      size = fontSize,
      bold = false,
      color = "0.09 0.13 0.2"
    ) => {
      commands.push(
        `BT ${color} rg /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(
          2
        )} ${y.toFixed(2)} Td (${escapePdfText(text)}) Tj ET`
      );
    };

    let y = pageHeight - margin;
    if (pageIndex === 0) {
      addText(title, margin, y, 17, true);
      y -= 19;
      addText(subtitle, margin, y, 8, false, "0.32 0.38 0.47");
      y -= 24;
    } else {
      addText(`${title} - continued`, margin, y, 11, true);
      y -= 22;
    }

    commands.push(
      `0.09 0.14 0.23 rg ${margin} ${y - 14} ${tableWidth} ${rowHeight} re f`
    );
    let x = margin;
    columns.forEach((column, index) => {
      addText(
        truncatePdfText(column.label, columnWidths[index] - 8, fontSize),
        x + 4,
        y - 8,
        fontSize,
        true,
        "1 1 1"
      );
      x += columnWidths[index];
    });
    y -= rowHeight;

    pageRows.forEach((row, rowIndex) => {
      if (rowIndex % 2 === 1) {
        commands.push(
          `0.96 0.97 0.98 rg ${margin} ${y - 14} ${tableWidth} ${rowHeight} re f`
        );
      }
      commands.push(
        `0.86 0.88 0.91 RG 0.4 w ${margin} ${y - 14} m ${
          margin + tableWidth
        } ${y - 14} l S`
      );
      x = margin;
      columns.forEach((column, index) => {
        addText(
          truncatePdfText(row[column.key], columnWidths[index] - 8, fontSize),
          x + 4,
          y - 8
        );
        x += columnWidths[index];
      });
      y -= rowHeight;
    });

    addText(
      `Page ${pageIndex + 1} of ${pages.length} | ${rows.length} record${
        rows.length === 1 ? "" : "s"
      }`,
      margin,
      18,
      7,
      false,
      "0.4 0.45 0.52"
    );

    const content = commands.join("\n");
    const contentId = addObject(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    );
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  });

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${
    objects.length + 1
  } /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
};
