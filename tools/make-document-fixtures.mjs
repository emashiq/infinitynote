#!/usr/bin/env node
// Writes the small sample documents under tests/fixtures/documents (Release 0.3.0, D-118, D-133): PDFs (plain, with an
// outline, password-protected and damaged), Word documents (a small one and a rich one with lists, a table, a picture,
// headers, footers, a footnote and a comment), presentations (a small one and a rich one with placeholders, a picture,
// speaker notes, a transition and a chart), a workbook, a CSV table and an HTML page with known text. The Office files
// are built from hand-written ECMA-376 parts zipped with yazl (MIT, already a dependency) and the PDF with hand-computed
// cross-reference offsets, so the files are generated here and copied from nowhere.
// Usage: node tools/make-document-fixtures.mjs [--out <dir>]
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import yazl from "yazl";

const argv = process.argv.slice(2);
const outIndex = argv.indexOf("--out");
const outDir = path.resolve(
  outIndex >= 0 ? argv[outIndex + 1] : "tests/fixtures/documents",
);
const ENTRY_TIME = new Date(Date.UTC(2026, 0, 1));
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument";

async function zip(parts) {
  const z = new yazl.ZipFile();
  for (const [name, text] of parts)
    z.addBuffer(Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8"), name, {
      mtime: ENTRY_TIME,
    });
  z.end();
  const chunks = [];
  for await (const chunk of z.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const types = (overrides, defaults = {}) =>
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(
    defaults,
  )
    .map(
      ([extension, type]) =>
        `<Default Extension="${extension}" ContentType="${type}"/>`,
    )
    .join("")}${Object.entries(
    overrides,
  )
    .map(
      ([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`,
    )
    .join("")}</Types>`;
const rels = (list) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`,
    )
    .join("")}</Relationships>`;

// PDF: pages of Helvetica text, optionally an outline (bookmarks to pages) and the standard security handler (RC4
// 40-bit, revision 2) with a user password; offsets are counted as the file is built.
const PDF_PAD = Buffer.from(
  "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
  "hex",
);
const md5 = (...parts) =>
  crypto.createHash("md5").update(Buffer.concat(parts)).digest();
const padPassword = (password) =>
  Buffer.concat([Buffer.from(password, "latin1"), PDF_PAD]).subarray(0, 32);

function rc4(key, data) {
  const box = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + box[i] + key[i % key.length]) & 255;
    [box[i], box[j]] = [box[j], box[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + box[i]) & 255;
    [box[i], box[j]] = [box[j], box[i]];
    out[n] = data[n] ^ box[(box[i] + box[j]) & 255];
  }
  return out;
}

/** ISO 32000-1, 7.6.3: the O and U entries and the file key for revision 2. */
function standardSecurity(userPassword, ownerPassword, id) {
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const owner = rc4(
    md5(padPassword(ownerPassword)).subarray(0, 5),
    padPassword(userPassword),
  );
  const key = md5(padPassword(userPassword), owner, permissions, id).subarray(
    0,
    5,
  );
  return { key, owner, user: rc4(key, PDF_PAD), permissions: -4 };
}

function pdf(pageTexts, { outline = [], userPassword = null } = {}) {
  const id = md5(Buffer.from(pageTexts.join("|"), "utf8"));
  const security = userPassword
    ? standardSecurity(userPassword, `${userPassword}-owner`, id)
    : null;
  const pageCount = pageTexts.length;
  const fontObj = 3 + pageCount;
  const firstStream = fontObj + 1;
  const firstOutline = firstStream + pageCount;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${outline.length ? ` /Outlines ${firstOutline} 0 R /PageMode /UseOutlines` : ""} >>`,
    `<< /Type /Pages /Kids [${pageTexts.map((_, i) => `${3 + i} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    ...pageTexts.map(
      (_, i) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${firstStream + i} 0 R >>`,
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...pageTexts.map((text) => ({
      stream: Buffer.from(`BT /F1 24 Tf 72 720 Td (${text}) Tj ET`, "latin1"),
    })),
  ];
  if (outline.length) {
    const first = firstOutline + 1;
    objects.push(
      `<< /Type /Outlines /First ${first} 0 R /Last ${first + outline.length - 1} 0 R /Count ${outline.length} >>`,
    );
    outline.forEach(([title, page], i) => {
      const links = [
        i > 0 ? `/Prev ${first + i - 1} 0 R` : "",
        i < outline.length - 1 ? `/Next ${first + i + 1} 0 R` : "",
      ].join(" ");
      objects.push(
        `<< /Title (${title}) /Parent ${firstOutline} 0 R ${links} /Dest [${3 + page - 1} 0 R /XYZ 0 792 0] >>`,
      );
    });
  }
  if (security)
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /O <${security.owner.toString("hex")}> /U <${security.user.toString("hex")}> /P ${security.permissions} >>`,
    );
  const chunks = [Buffer.from("%PDF-1.4\n", "latin1")];
  let length = chunks[0].length;
  const push = (buffer) => {
    chunks.push(buffer);
    length += buffer.length;
  };
  const offsets = objects.map((body, i) => {
    const offset = length;
    const number = i + 1;
    if (typeof body === "string") {
      push(Buffer.from(`${number} 0 obj\n${body}\nendobj\n`, "latin1"));
    } else {
      // Streams are encrypted with the object's key (7.6.2); the encryption dictionary itself is never encrypted.
      const objectKey = security
        ? md5(
            security.key,
            Buffer.from([
              number & 255,
              (number >> 8) & 255,
              (number >> 16) & 255,
              0,
              0,
            ]),
          ).subarray(0, 10)
        : null;
      const data = objectKey ? rc4(objectKey, body.stream) : body.stream;
      push(
        Buffer.from(
          `${number} 0 obj\n<< /Length ${data.length} >>\nstream\n`,
          "latin1",
        ),
      );
      push(data);
      push(Buffer.from("\nendstream\nendobj\n", "latin1"));
    }
    return offset;
  });
  const xref = length;
  const trailer = [
    `/Size ${objects.length + 1} /Root 1 0 R`,
    security
      ? `/Encrypt ${objects.length} 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>]`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const entries = offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("");
  push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}trailer\n<< ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`,
      "latin1",
    ),
  );
  return Buffer.concat(chunks);
}

function docx() {
  const W =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="' +
    REL +
    '"';
  const p = (text, style) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (text) =>
    `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
  const body = [
    p("Quarterly report", "Heading1"),
    '<w:p><w:r><w:t xml:space="preserve">Revenue grew by </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>twelve percent</w:t></w:r><w:r><w:t xml:space="preserve"> &amp; costs fell.</w:t></w:r></w:p>',
    `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr>${cell("Region")}${cell("Sales")}</w:tr><w:tr>${cell("North")}${cell("42")}</w:tr></w:tbl>`,
    p("Closing paragraph."),
  ].join("");
  const section =
    '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  return zip([
    [
      "[Content_Types].xml",
      types({
        "/word/document.xml": `${CT}.wordprocessingml.document.main+xml`,
        "/word/styles.xml": `${CT}.wordprocessingml.styles+xml`,
        "/word/header1.xml": `${CT}.wordprocessingml.header+xml`,
      }),
    ],
    ["_rels/.rels", rels([["rId1", "officeDocument", "word/document.xml"]])],
    [
      "word/_rels/document.xml.rels",
      rels([
        ["rId1", "styles", "styles.xml"],
        ["rId2", "header", "header1.xml"],
      ]),
    ],
    [
      "word/document.xml",
      `${XML}<w:document ${W}><w:body>${body}${section}</w:body></w:document>`,
    ],
    ["word/header1.xml", `${XML}<w:hdr ${W}>${p("Sample header")}</w:hdr>`],
    [
      "word/styles.xml",
      `${XML}<w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`,
    ],
  ]);
}

// A 2x2 red PNG (8-bit RGB), for the picture in the rich Word document.
function png() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.from([0, 255, 0, 0, 255, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat([row, row]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Word: headings, a numbered and a bulleted list, a table, an inline picture, a page break, a header and a footer, a
// footnote and a comment, for the editor's untouched-part and round-trip tests (D-142).
function docxRich() {
  const W =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="' +
    REL +
    '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const run = (text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const p = (text, style) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${run(text)}</w:p>`;
  const item = (text, numId) =>
    `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(text)}</w:p>`;
  const cell = (text) =>
    `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
  const row = (...texts) => `<w:tr>${texts.map(cell).join("")}</w:tr>`;
  const picture =
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Picture 1" descr="Red square"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId7"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const body = [
    p("Project handbook", "Heading1"),
    `<w:p><w:commentRangeStart w:id="0"/>${run("The handbook explains how the team works.")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
    p("Steps", "Heading2"),
    item("Plan the week", 1),
    item("Review the board", 1),
    p("Tools", "Heading2"),
    item("Calendar", 2),
    item("Notebook", 2),
    `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${row("Owner", "Task", "Due")}${row("Ada", "Draft agenda", "Monday")}</w:tbl>`,
    `<w:p>${picture}</w:p>`,
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    p("Appendix", "Heading1"),
    p("Last paragraph of the handbook."),
  ].join("");
  const section =
    '<w:sectPr><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  const style = (id, name, level) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${level}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${32 - level * 4}"/></w:rPr></w:style>`;
  const level = (format, text) =>
    `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
  return zip([
    [
      "[Content_Types].xml",
      types(
        {
          "/word/document.xml": `${CT}.wordprocessingml.document.main+xml`,
          "/word/styles.xml": `${CT}.wordprocessingml.styles+xml`,
          "/word/numbering.xml": `${CT}.wordprocessingml.numbering+xml`,
          "/word/header1.xml": `${CT}.wordprocessingml.header+xml`,
          "/word/footer1.xml": `${CT}.wordprocessingml.footer+xml`,
          "/word/footnotes.xml": `${CT}.wordprocessingml.footnotes+xml`,
          "/word/comments.xml": `${CT}.wordprocessingml.comments+xml`,
        },
        { png: "image/png" },
      ),
    ],
    ["_rels/.rels", rels([["rId1", "officeDocument", "word/document.xml"]])],
    [
      "word/_rels/document.xml.rels",
      rels([
        ["rId1", "styles", "styles.xml"],
        ["rId2", "numbering", "numbering.xml"],
        ["rId3", "footnotes", "footnotes.xml"],
        ["rId4", "header", "header1.xml"],
        ["rId5", "footer", "footer1.xml"],
        ["rId6", "comments", "comments.xml"],
        ["rId7", "image", "media/image1.png"],
      ]),
    ],
    [
      "word/document.xml",
      `${XML}<w:document ${W}><w:body>${body}${section}</w:body></w:document>`,
    ],
    ["word/header1.xml", `${XML}<w:hdr ${W}>${p("Handbook header")}</w:hdr>`],
    ["word/footer1.xml", `${XML}<w:ftr ${W}>${p("Handbook footer")}</w:ftr>`],
    [
      "word/footnotes.xml",
      `${XML}<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>${run(" Written for new members.")}</w:p></w:footnote></w:footnotes>`,
    ],
    [
      "word/comments.xml",
      `${XML}<w:comments ${W}><w:comment w:id="0" w:author="Reviewer" w:date="2026-01-01T00:00:00Z" w:initials="R"><w:p>${run("Check this sentence")}</w:p></w:comment></w:comments>`,
    ],
    [
      "word/numbering.xml",
      `${XML}<w:numbering ${W}><w:abstractNum w:abstractNumId="0">${level("decimal", "%1.")}</w:abstractNum><w:abstractNum w:abstractNumId="1">${level("bullet", "•")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    ],
    [
      "word/styles.xml",
      `${XML}<w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style("Heading1", "heading 1", 0)}${style("Heading2", "heading 2", 1)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style></w:styles>`,
    ],
    ["word/media/image1.png", png()],
  ]);
}

// PresentationML pieces shared by the sample decks.
const PML =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' +
  REL +
  '" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const PML_GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const THEME_COLORS = [
  "dk1",
  "lt1",
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
];
const THEME_FILL = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const PML_THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture"><a:themeElements><a:clrScheme name="Fixture">${THEME_COLORS
  .map(
    (c, i) =>
      `<a:${c}><a:srgbClr val="${i % 2 ? "FFFFFF" : "1F4E79"}"/></a:${c}>`,
  )
  .join(
    "",
  )}</a:clrScheme><a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Fixture"><a:fillStyleLst>${THEME_FILL.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${`<a:ln w="9525">${THEME_FILL}</a:ln>`.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${THEME_FILL.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const PML_CLR_MAP =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

function pptx() {
  const box = (id, text, y) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="${y}"/><a:ext cx="10515600" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3600"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const slide = (title, body) =>
    `${XML}<p:sld ${PML}><p:cSld><p:spTree>${PML_GROUP}${box(2, title, 365125)}${box(3, body, 2000000)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  return zip([
    [
      "[Content_Types].xml",
      types({
        "/ppt/presentation.xml": `${CT}.presentationml.presentation.main+xml`,
        "/ppt/slideMasters/slideMaster1.xml": `${CT}.presentationml.slideMaster+xml`,
        "/ppt/slideLayouts/slideLayout1.xml": `${CT}.presentationml.slideLayout+xml`,
        "/ppt/slides/slide1.xml": `${CT}.presentationml.slide+xml`,
        "/ppt/slides/slide2.xml": `${CT}.presentationml.slide+xml`,
        "/ppt/theme/theme1.xml": `${CT}.theme+xml`,
      }),
    ],
    ["_rels/.rels", rels([["rId1", "officeDocument", "ppt/presentation.xml"]])],
    [
      "ppt/_rels/presentation.xml.rels",
      rels([
        ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
        ["rId2", "slide", "slides/slide1.xml"],
        ["rId3", "slide", "slides/slide2.xml"],
        ["rId4", "theme", "theme/theme1.xml"],
      ]),
    ],
    [
      "ppt/presentation.xml",
      `${XML}<p:presentation ${PML}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    ],
    [
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      rels([
        ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
        ["rId2", "theme", "../theme/theme1.xml"],
      ]),
    ],
    [
      "ppt/slideMasters/slideMaster1.xml",
      `${XML}<p:sldMaster ${PML}><p:cSld><p:spTree>${PML_GROUP}</p:spTree></p:cSld><p:clrMap ${PML_CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    ],
    [
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
    ],
    [
      "ppt/slideLayouts/slideLayout1.xml",
      `${XML}<p:sldLayout ${PML} type="blank"><p:cSld name="Blank"><p:spTree>${PML_GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    ],
    [
      "ppt/slides/_rels/slide1.xml.rels",
      rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]]),
    ],
    [
      "ppt/slides/_rels/slide2.xml.rels",
      rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]]),
    ],
    ["ppt/slides/slide1.xml", slide("Welcome slide", "Roadmap for the launch")],
    ["ppt/slides/slide2.xml", slide("Second slide", "Questions &amp; answers")],
    ["ppt/theme/theme1.xml", PML_THEME],
  ]);
}

// Presentation: a title layout with title and body placeholders, mixed bold and plain runs, a picture, speaker notes on
// two slides (a notes master), a slide transition and a chart (what the viewer lists as not shown), for the editor's
// preservation and round-trip tests (F5).
function pptxRich() {
  const PIC =
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const run = (text, attrs = "") =>
    `<a:r><a:rPr lang="en-US"${attrs}/><a:t>${text}</a:t></a:r>`;
  const xfrm = (x, y, cx, cy) =>
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
  const placeholder = (id, type, idx, paragraphs, transform = "") =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${type} ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${idx === null ? "" : ` idx="${idx}"`}/></p:nvPr></p:nvSpPr><p:spPr>${transform}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
  const textBox = (id, text, y) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(838200, y, 10515600, 1325563)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${run(text, ' sz="2800"')}</a:p></p:txBody></p:sp>`;
  const picture = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 4"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(9144000, 4572000, 1828800, 1828800)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const chartFrame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Chart 5"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="838200" y="3500000"/><a:ext cx="4572000" cy="2286000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId4"/></a:graphicData></a:graphic></p:graphicFrame>`;
  const slide = (shapes, extra = "") =>
    `${XML}<p:sld ${PML}${PIC}><p:cSld><p:spTree>${PML_GROUP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${extra}</p:sld>`;
  const notes = (text) =>
    `${XML}<p:notes ${PML}><p:cSld><p:spTree>${PML_GROUP}${placeholder(2, "sldImg", null, "<a:p/>")}${placeholder(3, "body", 1, `<a:p>${run(text)}</a:p>`)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
  const slideRels = (notesPart, more = []) =>
    rels([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ...more,
      ...(notesPart
        ? [["rId3", "notesSlide", `../notesSlides/${notesPart}`]]
        : []),
    ]);
  const notesRels = (slidePart) =>
    rels([
      ["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"],
      ["rId2", "slide", `../slides/${slidePart}`],
    ]);
  const chart = `${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>North</c:v></c:pt><c:pt idx="1"><c:v>South</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:ptCount val="2"/><c:pt idx="0"><c:v>4</c:v></c:pt><c:pt idx="1"><c:v>7</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`;
  const layout = `${XML}<p:sldLayout ${PML} type="obj"><p:cSld name="Title and Content"><p:spTree>${PML_GROUP}${placeholder(2, "title", null, "<a:p/>", xfrm(838200, 365125, 10515600, 1325563))}${placeholder(3, "body", 1, "<a:p/>", xfrm(838200, 1825625, 10515600, 2351338))}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const PRESENTATIONML = `${CT}.presentationml`;
  return zip([
    [
      "[Content_Types].xml",
      types(
        {
          "/ppt/presentation.xml": `${PRESENTATIONML}.presentation.main+xml`,
          "/ppt/slideMasters/slideMaster1.xml": `${PRESENTATIONML}.slideMaster+xml`,
          "/ppt/slideLayouts/slideLayout1.xml": `${PRESENTATIONML}.slideLayout+xml`,
          "/ppt/slides/slide1.xml": `${PRESENTATIONML}.slide+xml`,
          "/ppt/slides/slide2.xml": `${PRESENTATIONML}.slide+xml`,
          "/ppt/slides/slide3.xml": `${PRESENTATIONML}.slide+xml`,
          "/ppt/notesMasters/notesMaster1.xml": `${PRESENTATIONML}.notesMaster+xml`,
          "/ppt/notesSlides/notesSlide1.xml": `${PRESENTATIONML}.notesSlide+xml`,
          "/ppt/notesSlides/notesSlide2.xml": `${PRESENTATIONML}.notesSlide+xml`,
          "/ppt/charts/chart1.xml": `${CT}.drawingml.chart+xml`,
          "/ppt/theme/theme1.xml": `${CT}.theme+xml`,
          "/ppt/theme/theme2.xml": `${CT}.theme+xml`,
          "/docProps/app.xml": `${CT}.extended-properties+xml`,
        },
        { png: "image/png" },
      ),
    ],
    [
      "_rels/.rels",
      rels([
        ["rId1", "officeDocument", "ppt/presentation.xml"],
        ["rId2", "extended-properties", "docProps/app.xml"],
      ]),
    ],
    [
      "docProps/app.xml",
      `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Infinity Notes fixtures</Application><Slides>3</Slides></Properties>`,
    ],
    [
      "ppt/_rels/presentation.xml.rels",
      rels([
        ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
        ["rId2", "slide", "slides/slide1.xml"],
        ["rId3", "slide", "slides/slide2.xml"],
        ["rId4", "slide", "slides/slide3.xml"],
        ["rId5", "notesMaster", "notesMasters/notesMaster1.xml"],
        ["rId6", "theme", "theme/theme1.xml"],
      ]),
    ],
    [
      "ppt/presentation.xml",
      `${XML}<p:presentation ${PML}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId5"/></p:notesMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    ],
    [
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      rels([
        ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
        ["rId2", "theme", "../theme/theme1.xml"],
      ]),
    ],
    [
      "ppt/slideMasters/slideMaster1.xml",
      `${XML}<p:sldMaster ${PML}><p:cSld><p:spTree>${PML_GROUP}</p:spTree></p:cSld><p:clrMap ${PML_CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    ],
    [
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
    ],
    ["ppt/slideLayouts/slideLayout1.xml", layout],
    [
      "ppt/notesMasters/_rels/notesMaster1.xml.rels",
      rels([["rId1", "theme", "../theme/theme2.xml"]]),
    ],
    [
      "ppt/notesMasters/notesMaster1.xml",
      `${XML}<p:notesMaster ${PML}><p:cSld><p:spTree>${PML_GROUP}${placeholder(2, "body", 1, "<a:p/>", xfrm(685800, 4400550, 5486400, 3600450))}</p:spTree></p:cSld><p:clrMap ${PML_CLR_MAP}/></p:notesMaster>`,
    ],
    [
      "ppt/slides/_rels/slide1.xml.rels",
      slideRels("notesSlide1.xml", [["rId2", "image", "../media/image1.png"]]),
    ],
    [
      "ppt/slides/slide1.xml",
      slide(
        `${placeholder(2, "title", null, `<a:p>${run("Quarterly review")}</a:p>`)}${placeholder(3, "body", 1, `<a:p>${run("Revenue grew ")}${run("strongly", ' b="1"')}${run(" this quarter")}</a:p>`)}${picture}`,
      ),
    ],
    ["ppt/notesSlides/_rels/notesSlide1.xml.rels", notesRels("slide1.xml")],
    ["ppt/notesSlides/notesSlide1.xml", notes("Thank the team first")],
    [
      "ppt/slides/_rels/slide2.xml.rels",
      slideRels("notesSlide2.xml", [["rId4", "chart", "../charts/chart1.xml"]]),
    ],
    [
      "ppt/slides/slide2.xml",
      slide(
        `${textBox(2, "Agenda overview", 365125)}${chartFrame}`,
        '<p:transition spd="med"><p:fade/></p:transition>',
      ),
    ],
    ["ppt/charts/chart1.xml", chart],
    ["ppt/notesSlides/_rels/notesSlide2.xml.rels", notesRels("slide2.xml")],
    ["ppt/notesSlides/notesSlide2.xml", notes("Mention the timeline")],
    ["ppt/slides/_rels/slide3.xml.rels", slideRels(null)],
    ["ppt/slides/slide3.xml", slide(textBox(2, "Closing words", 365125))],
    ["ppt/media/image1.png", png()],
    ["ppt/theme/theme1.xml", PML_THEME],
    ["ppt/theme/theme2.xml", PML_THEME],
  ]);
}

function xlsx() {
  const S =
    'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' +
    REL +
    '"';
  const strings = [
    "Item",
    "Cost",
    "Coffee beans",
    "Paper",
    "Total",
    "Remember the receipts",
  ];
  const s = (ref, index) => `<c r="${ref}" t="s"><v>${index}</v></c>`;
  const n = (ref, value) => `<c r="${ref}"><v>${value}</v></c>`;
  const budget = `<sheetData><row r="1">${s("A1", 0)}${s("B1", 1)}</row><row r="2">${s("A2", 2)}${n("B2", 12.5)}</row><row r="3">${s("A3", 3)}${n("B3", 4)}</row><row r="4">${s("A4", 4)}<c r="B4"><f>SUM(B2:B3)</f><v>16.5</v></c></row></sheetData>`;
  return zip([
    [
      "[Content_Types].xml",
      types({
        "/xl/workbook.xml": `${CT}.spreadsheetml.sheet.main+xml`,
        "/xl/worksheets/sheet1.xml": `${CT}.spreadsheetml.worksheet+xml`,
        "/xl/worksheets/sheet2.xml": `${CT}.spreadsheetml.worksheet+xml`,
        "/xl/sharedStrings.xml": `${CT}.spreadsheetml.sharedStrings+xml`,
      }),
    ],
    ["_rels/.rels", rels([["rId1", "officeDocument", "xl/workbook.xml"]])],
    [
      "xl/_rels/workbook.xml.rels",
      rels([
        ["rId1", "worksheet", "worksheets/sheet1.xml"],
        ["rId2", "worksheet", "worksheets/sheet2.xml"],
        ["rId3", "sharedStrings", "sharedStrings.xml"],
      ]),
    ],
    [
      "xl/workbook.xml",
      `${XML}<workbook ${S}><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes &amp; ideas" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    ],
    ["xl/worksheets/sheet1.xml", `${XML}<worksheet ${S}>${budget}</worksheet>`],
    [
      "xl/worksheets/sheet2.xml",
      `${XML}<worksheet ${S}><sheetData><row r="1">${s("A1", 5)}</row></sheetData></worksheet>`,
    ],
    [
      "xl/sharedStrings.xml",
      `${XML}<sst ${S} count="${strings.length}" uniqueCount="${strings.length}">${strings.map((t) => `<si><t>${t}</t></si>`).join("")}</sst>`,
    ],
  ]);
}

const CSV =
  'Name,Amount\r\nCoffee beans,12.5\r\n"Tea, green",4\r\n"Quote ""inside""",0\r\n';

// The page carries what the viewer must neutralize: a script, a remote image and stylesheet, a form and links.
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sample page title</title>
<link rel="stylesheet" href="https://example.com/remote.css">
<style>body { font-family: sans-serif; } .note { color: #1f4e79; }</style>
<script>document.title = 'script ran'; fetch('https://example.com/beacon');</script>
</head>
<body>
<h1>Sample web page</h1>
<p class="note">A paragraph with an <a href="https://example.com/docs">external link</a> and <a href="#local">a local anchor</a>.</p>
<p>Caf&eacute; &amp; cr&egrave;me &mdash; entities decode.</p>
<img alt="remote" src="https://example.com/remote.png">
<img alt="embedded" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=">
<form action="https://example.com/submit"><input name="q"><button>Send</button></form>
<p id="local">The end.</p>
</body>
</html>
`;

const files = [
  [
    "sample.pdf",
    pdf(["Infinity Notes sample PDF", "Second page of the sample"]),
  ],
  [
    "sample-pages.pdf",
    pdf(
      [
        "Alpha page introduces the plan",
        "Bravo page lists the details",
        "Charlie page closes the summary",
      ],
      {
        outline: [
          ["Introduction", 1],
          ["Details", 2],
          ["Summary", 3],
        ],
      },
    ),
  ],
  [
    "sample-protected.pdf",
    pdf(["Protected sample text"], { userPassword: "infinity" }),
  ],
  // A PDF header over bytes that are not a PDF: imported like any PDF, refused by the viewer with a clear message.
  [
    "sample-damaged.pdf",
    Buffer.from("%PDF-1.7\nThis is not really a PDF document.\n", "latin1"),
  ],
  ["sample.docx", await docx()],
  ["sample-rich.docx", await docxRich()],
  ["sample.pptx", await pptx()],
  ["sample-rich.pptx", await pptxRich()],
  ["sample.xlsx", await xlsx()],
  ["sample.csv", Buffer.from(CSV, "utf8")],
  ["sample.html", Buffer.from(HTML, "utf8")],
];
fs.mkdirSync(outDir, { recursive: true });
for (const [name, bytes] of files) {
  fs.writeFileSync(path.join(outDir, name), bytes);
  console.log(`${name} ${bytes.length} bytes`);
}
