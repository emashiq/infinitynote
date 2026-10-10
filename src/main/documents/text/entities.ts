/** The five XML entities; HTML adds the named ones people meet in saved pages. */
const XML_ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  ...XML_ENTITIES,
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  times: '×',
  divide: '÷',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  auml: 'ä',
  ccedil: 'ç',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  iacute: 'í',
  ntilde: 'ñ',
  oacute: 'ó',
  ouml: 'ö',
  uacute: 'ú',
  uuml: 'ü',
  szlig: 'ß',
};

const ENTITY = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g;

function decodeWith(text: string, named: Readonly<Record<string, string>>): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (whole, body: string) => {
    if (body[0] !== '#') return named[body] ?? whole;
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

export const decodeXmlEntities = (text: string): string => decodeWith(text, XML_ENTITIES);
export const decodeHtmlEntities = (text: string): string => decodeWith(text, HTML_ENTITIES);
