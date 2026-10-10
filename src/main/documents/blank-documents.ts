import yazl from 'yazl';
import type { BlankDocumentKind } from '../../shared/documents/kinds';

/**
 * Minimal valid Office files for "New Word document", "New spreadsheet" and "New presentation" (D-118), written by
 * hand from the ECMA-376 schemas (element order matters there) rather than by a library, so nothing new ships in main.
 * Each has the parts Word, Excel, PowerPoint and LibreOffice need, and nothing more: A4 pages in Calibri, one empty
 * sheet, one blank 16:9 slide.
 */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = {
  contentTypes: 'http://schemas.openxmlformats.org/package/2006/content-types',
  relationships: 'http://schemas.openxmlformats.org/package/2006/relationships',
  officeRel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  word: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  sheet: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  drawing: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  presentation: 'http://schemas.openxmlformats.org/presentationml/2006/main',
} as const;
const CT = 'application/vnd.openxmlformats-officedocument';
const PML_NS = `xmlns:a="${NS.drawing}" xmlns:r="${NS.officeRel}" xmlns:p="${NS.presentation}"`;

/** The fixed timestamp of every entry, so a blank file is the same bytes every time. */
const ENTRY_TIME = new Date(Date.UTC(2026, 0, 1));

type Parts = ReadonlyArray<readonly [name: string, xml: string]>;

function contentTypes(overrides: Record<string, string>): string {
  const entries = Object.entries(overrides)
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join('');
  return `${XML_HEAD}<Types xmlns="${NS.contentTypes}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${entries}</Types>`;
}

function relationships(rels: ReadonlyArray<readonly [id: string, type: string, target: string]>): string {
  const entries = rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${NS.officeRel}/${type}" Target="${target}"/>`).join('');
  return `${XML_HEAD}<Relationships xmlns="${NS.relationships}">${entries}</Relationships>`;
}

function headingStyle(level: number, halfPoints: number): string {
  return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr></w:style>`;
}

const DOCX: Parts = [
  [
    '[Content_Types].xml',
    contentTypes({ '/word/document.xml': `${CT}.wordprocessingml.document.main+xml`, '/word/styles.xml': `${CT}.wordprocessingml.styles+xml` }),
  ],
  ['_rels/.rels', relationships([['rId1', 'officeDocument', 'word/document.xml']])],
  ['word/_rels/document.xml.rels', relationships([['rId1', 'styles', 'styles.xml']])],
  [
    'word/document.xml',
    `${XML_HEAD}<w:document xmlns:w="${NS.word}" xmlns:r="${NS.officeRel}"><w:body><w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  ],
  [
    'word/styles.xml',
    `${XML_HEAD}<w:styles xmlns:w="${NS.word}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${headingStyle(1, 32)}${headingStyle(2, 26)}${headingStyle(3, 24)}<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style></w:styles>`,
  ],
];

const XLSX: Parts = [
  [
    '[Content_Types].xml',
    contentTypes({
      '/xl/workbook.xml': `${CT}.spreadsheetml.sheet.main+xml`,
      '/xl/worksheets/sheet1.xml': `${CT}.spreadsheetml.worksheet+xml`,
      '/xl/styles.xml': `${CT}.spreadsheetml.styles+xml`,
    }),
  ],
  ['_rels/.rels', relationships([['rId1', 'officeDocument', 'xl/workbook.xml']])],
  [
    'xl/_rels/workbook.xml.rels',
    relationships([
      ['rId1', 'worksheet', 'worksheets/sheet1.xml'],
      ['rId2', 'styles', 'styles.xml'],
    ]),
  ],
  ['xl/workbook.xml', `${XML_HEAD}<workbook xmlns="${NS.sheet}" xmlns:r="${NS.officeRel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/worksheets/sheet1.xml', `${XML_HEAD}<worksheet xmlns="${NS.sheet}" xmlns:r="${NS.officeRel}"><sheetData/></worksheet>`],
  [
    'xl/styles.xml',
    `${XML_HEAD}<styleSheet xmlns="${NS.sheet}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  ],
];

const EMPTY_SHAPE_TREE =
  '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
const SCHEME_COLORS = [
  ['dk1', '<a:sysClr val="windowText" lastClr="000000"/>'],
  ['lt1', '<a:sysClr val="window" lastClr="FFFFFF"/>'],
  ['dk2', '<a:srgbClr val="44546A"/>'],
  ['lt2', '<a:srgbClr val="E7E6E6"/>'],
  ['accent1', '<a:srgbClr val="4472C4"/>'],
  ['accent2', '<a:srgbClr val="ED7D31"/>'],
  ['accent3', '<a:srgbClr val="A5A5A5"/>'],
  ['accent4', '<a:srgbClr val="FFC000"/>'],
  ['accent5', '<a:srgbClr val="5B9BD5"/>'],
  ['accent6', '<a:srgbClr val="70AD47"/>'],
  ['hlink', '<a:srgbClr val="0563C1"/>'],
  ['folHlink', '<a:srgbClr val="954F72"/>'],
] as const;
const threeTimes = (xml: string): string => xml.repeat(3);
const PH_FILL = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const THEME = `${XML_HEAD}<a:theme xmlns:a="${NS.drawing}" name="Office Theme"><a:themeElements><a:clrScheme name="Office">${SCHEME_COLORS.map(([name, color]) => `<a:${name}>${color}</a:${name}>`).join('')}</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst>${threeTimes(PH_FILL)}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}">${PH_FILL}</a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${threeTimes('<a:effectStyle><a:effectLst/></a:effectStyle>')}</a:effectStyleLst><a:bgFillStyleLst>${threeTimes(PH_FILL)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
const textStyle = (size: number, font: '+mj-lt' | '+mn-lt') =>
  `<a:lvl1pPr><a:defRPr sz="${size}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="${font}"/></a:defRPr></a:lvl1pPr>`;
const COLOR_MAP =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

const PPTX: Parts = [
  [
    '[Content_Types].xml',
    contentTypes({
      '/ppt/presentation.xml': `${CT}.presentationml.presentation.main+xml`,
      '/ppt/slideMasters/slideMaster1.xml': `${CT}.presentationml.slideMaster+xml`,
      '/ppt/slideLayouts/slideLayout1.xml': `${CT}.presentationml.slideLayout+xml`,
      '/ppt/slides/slide1.xml': `${CT}.presentationml.slide+xml`,
      '/ppt/theme/theme1.xml': `${CT}.theme+xml`,
    }),
  ],
  ['_rels/.rels', relationships([['rId1', 'officeDocument', 'ppt/presentation.xml']])],
  [
    'ppt/_rels/presentation.xml.rels',
    relationships([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'slide', 'slides/slide1.xml'],
      ['rId3', 'theme', 'theme/theme1.xml'],
    ]),
  ],
  [
    'ppt/presentation.xml',
    `${XML_HEAD}<p:presentation ${PML_NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  ],
  [
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    relationships([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'theme', '../theme/theme1.xml'],
    ]),
  ],
  [
    'ppt/slideMasters/slideMaster1.xml',
    `${XML_HEAD}<p:sldMaster ${PML_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_SHAPE_TREE}</p:cSld><p:clrMap ${COLOR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${textStyle(4400, '+mj-lt')}</p:titleStyle><p:bodyStyle>${textStyle(2800, '+mn-lt')}</p:bodyStyle><p:otherStyle>${textStyle(1800, '+mn-lt')}</p:otherStyle></p:txStyles></p:sldMaster>`,
  ],
  ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationships([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])],
  [
    'ppt/slideLayouts/slideLayout1.xml',
    `${XML_HEAD}<p:sldLayout ${PML_NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_SHAPE_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  ],
  ['ppt/slides/_rels/slide1.xml.rels', relationships([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])],
  ['ppt/slides/slide1.xml', `${XML_HEAD}<p:sld ${PML_NS}><p:cSld>${EMPTY_SHAPE_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`],
  ['ppt/theme/theme1.xml', THEME],
];

const BLANK_PARTS: Readonly<Record<BlankDocumentKind, Parts>> = { docx: DOCX, xlsx: XLSX, pptx: PPTX };

/** The bytes of a new empty document of the kind. */
export async function blankDocument(kind: BlankDocumentKind): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, xml] of BLANK_PARTS[kind]) zip.addBuffer(Buffer.from(xml, 'utf8'), name, { mtime: ENTRY_TIME, compress: true });
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
