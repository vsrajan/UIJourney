#!/usr/bin/env node
// Decides whether a library glyph's own text is scaffolding (stand-in copy
// that should not reach a mockup) or real content. Used by compose-scene.mjs.
//
//   node scripts/placeholder-text.mjs --selftest
//   node scripts/placeholder-text.mjs "Card Title" Card
//
// Only ever consulted for text the spec said nothing about — spec-supplied
// copy always wins before this runs. Erring towards dropping is the safer
// mistake here, because the composer prints everything it drops: a wrongly
// dropped line is visible and fixable, while surviving scaffolding reads as
// real screen copy and gets reviewed as if someone chose it.

// Components whose stand-in text IS the affordance rather than scaffolding.
export const PLACEHOLDER_HOSTS = new Set([
  "Input", "Textarea", "Select", "Combobox", "SearchInput", "DatePicker",
]);

// Whole-string stand-ins that name no component.
const SCAFFOLD_PHRASES = new Set([
  "label", "placeholder", "title", "description", "text", "content", "value", "item",
  "heading", "subheading", "subtitle", "caption", "body", "name",
  "content goes here", "your text here", "your content here", "add content",
  "example", "sample text", "click me", "untitled", "hello world",
  "something went wrong", "an error occurred", "coming soon",
]);

// Kit demo copy that starts this way is filler however it continues.
const SCAFFOLD_PREFIXES = ["lorem ipsum", "the quick brown fox"];

// "Tab 1", "Column 3", "Cell 1-1", "Option 2", "Row 4", "Item 1.2" — a short
// word followed by an index. Real screen copy almost never looks like this,
// and every kit numbers its demo repeaters.
const ENUMERATED = /^[A-Za-z][A-Za-z ]{0,18}[ \-]?\d+([.\-]\d+)*$/;

const normalize = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function isScaffoldText(text, component, rootComponent) {
  const raw = String(text ?? "").trim();
  if (!raw) return true;

  const lower = raw.toLowerCase();
  if (SCAFFOLD_PHRASES.has(lower)) return true;
  if (SCAFFOLD_PREFIXES.some((p) => lower.startsWith(p))) return true;
  if (ENUMERATED.test(raw)) return true;

  // Text built from the component's own name: Card -> "Card Title",
  // "Card content goes here"; Dialog -> "Dialog Title".
  const n = normalize(raw);
  for (const c of [component, rootComponent]) {
    const cn = normalize(c);
    if (!cn) continue;
    if (n === cn || (n.startsWith(cn) && n.length <= cn.length + 24)) return true;
  }
  return false;
}

// ------------------------------------------------------------- self-test
const CASES = [
  // [root, component, text, expectScaffold]
  ["Card", "CardTitle", "Card Title", true],
  ["Card", "CardDescription", "Card Description", true],
  ["Card", "CardContent", "Card content goes here", true],
  ["Checkbox", "CheckboxLabel", "Label", true],
  ["Button", "ButtonLabel", "Button", true],
  ["Button", "ButtonLabel", "Click me", true],
  ["Accordion", "AccordionItem", "Accordion Item 1", true],
  ["Dialog", "DialogTitle", "Dialog Title", true],
  ["Alert", "AlertTitle", "Alert Title", true],
  ["Alert", "AlertDescription", "Something went wrong", true],
  ["Badge", "BadgeLabel", "Badge", true],
  ["Tabs", "TabsTrigger", "Tab 1", true],
  ["Table", "TableCell", "Cell 1-1", true],
  ["Table", "TableHead", "Column 3", true],
  ["Select", "SelectItem", "Option 1", true],
  ["Text", "Text", "Lorem ipsum dolor sit amet, consectetur", true],
  ["Tooltip", "TooltipContent", "Tooltip", true],
  ["Sheet", "SheetTitle", "Sheet Title", true],
  // Real copy that must survive.
  ["Avatar", "AvatarFallback", "JD", false],
  ["Badge", "BadgeLabel", "Active", false],
  ["Button", "ButtonLabel", "Sign in", false],
  ["Button", "ButtonLabel", "Approve Selected", false],
  ["Text", "Text", "Review and action pending work items", false],
  ["Breadcrumb", "BreadcrumbItem", "Home", false],
  ["Heading", "Heading", "Work Items", false],
  ["TableCell", "TableCell", "Access Request", false],
  ["Link", "Link", "Forgot password?", false],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--selftest") {
    let bad = 0;
    for (const [root, comp, text, want] of CASES) {
      const got = isScaffoldText(text, comp, root);
      if (got !== want) {
        bad++;
        console.log(`FAIL  ${root}/${comp} ${JSON.stringify(text)} -> scaffold=${got}, want ${want}`);
      }
    }
    console.log(bad ? `\n${bad} failure(s) of ${CASES.length}` : `all ${CASES.length} cases pass`);
    process.exit(bad ? 1 : 0);
  }
  const [text, component, root] = argv;
  console.log(isScaffoldText(text, component, root ?? component));
}
