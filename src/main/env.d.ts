declare module '*.css?raw' {
  const css: string;
  export default css;
}

declare module '*.sql?raw' {
  const sql: string;
  export default sql;
}
