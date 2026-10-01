/** Just enough XML for AniDB: elements, attributes, text, CDATA, entities. No namespaces, no DTD. */
export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const tag =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const top = stack.at(-1)!;
    top.text += decodeEntities(xml.slice(last, m.index));
    last = tag.lastIndex;
    if (m[1] !== undefined) {
      top.text += m[1];
      continue;
    }
    if (!m[3]) continue; // comment, declaration, doctype
    if (m[2] === "/") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[4]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? "");
    const node: XmlNode = { name: m[3], attrs, children: [], text: "" };
    top.children.push(node);
    if (!m[5]) stack.push(node);
  }
  return root;
}

export const child = (node: XmlNode | undefined, name: string) => node?.children.find((c) => c.name === name);
export const childrenOf = (node: XmlNode | undefined, name: string) => node?.children.filter((c) => c.name === name) ?? [];
export const textOf = (node: XmlNode | undefined) => node?.text.trim() || undefined;
