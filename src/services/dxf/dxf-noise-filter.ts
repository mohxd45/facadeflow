/**
 * DXF Noise Layer Filter — Phase 15
 *
 * Construction DXF files contain many layers that are definitively not
 * quantity-takeoff geometry: dimension lines, annotation text, fastener
 * symbols, MEP references, PDF underlays, grids, and more.
 *
 * `isNoiseLayer(name)` returns true when a layer should be skipped by
 * default. A saved enabled layer mapping always overrides this decision
 * — allowing the user to whitelist a layer even if its name looks noisy.
 */

/** Each entry: [pattern, description for tooltips / debug] */
const NOISE_PATTERNS: Array<[RegExp, string]> = [
  // Dimension / measurement annotation
  [/^0$/, "default scratch layer"],
  [/\bDEFPOINTS\b/i, "AutoCAD dimension-extension points"],
  [/\bDIM(ENSION)?\b/i, "dimensions"],
  [/\bEL[\s_-]*DIM\b/i, "elevation dimension"],

  // Text / annotation
  [/\bTEXT\b/i, "text labels"],
  [/\bNOTE(S)?\b/i, "notes"],
  [/\bANNO(TATION)?\b/i, "annotation"],
  [/\bLABEL(S)?\b/i, "labels"],
  [/\bCAPTION(S)?\b/i, "captions"],

  // Fasteners / hardware (clearly not area/length quantities)
  [/\bSCREW(S)?\b/i, "screws"],
  [/\bFASTENER(S)?\b/i, "fasteners"],
  [/\bRIVET(S)?\b/i, "rivets"],
  [/\bBOLT(S)?\b/i, "bolts"],
  [/\bNUT(S)?\b/i, "nuts"],
  [/\bWASHER(S)?\b/i, "washers"],
  [/\bANCHOR(S)?\b/i, "anchors"],

  // Reference / grid geometry
  [/\bLEVEL(S)?\b/i, "level lines"],
  [/\bGRID(S)?\b/i, "grid lines"],
  [/\bAXIS\b/i, "axis lines"],
  [/\bCENTRE[\s_-]*LINE\b/i, "centre lines"],
  [/\bCL\b/i, "centre lines shorthand"],
  [/\bREF(ERENCE)?\b/i, "reference lines"],

  // Symbols / blocks used as annotation
  [/\bSYMBOL(S)?\b/i, "symbols"],
  [/\bBLOCKREF\b/i, "block references"],
  [/\bTAG(S)?\b/i, "tags"],
  [/\bMARK(S|ER|ERS)?\b/i, "markers"],
  [/\bNORTH[\s_-]*ARROW\b/i, "north arrow"],
  [/\bSECTION[\s_-]*MARK\b/i, "section mark"],
  [/\bELEVATION[\s_-]*MARK\b/i, "elevation mark"],
  [/\bDETAIL[\s_-]*MARK\b/i, "detail mark"],
  [/\bBUBBLE(S)?\b/i, "callout bubbles"],
  [/\bCALLOUT(S)?\b/i, "callouts"],
  [/\bREVISION\b/i, "revision clouds"],

  // Hatching / fill
  [/\bHATCH\b/i, "hatching"],
  [/\bFILL\b/i, "fill patterns"],
  [/\bPATTERN\b/i, "patterns"],

  // External references / PDF underlays
  [/\bXREF\b/i, "external reference"],
  [/\bXR[-_]/i, "xref prefix"],
  [/\bPDF\b/i, "PDF underlay"],
  [/\bUNDERLAY\b/i, "underlay"],

  // Furniture / fixtures (not facade-relevant)
  [/\bFURNITURE(S)?\b/i, "furniture"],
  [/\bFURN\b/i, "furniture shorthand"],
  [/\bFIXTURE(S)?\b/i, "fixtures"],
  [/\bEQUIPMENT\b/i, "equipment"],

  // MEP (Mechanical / Electrical / Plumbing)
  [/\bMEP\b/i, "MEP services"],
  [/\bELECT(RICAL)?\b/i, "electrical"],
  [/\bPLUMBING\b/i, "plumbing"],
  [/\bMECHANICAL\b/i, "mechanical"],
  [/\bHVAC\b/i, "HVAC"],
  [/\bSPRINKLER\b/i, "sprinkler"],
  [/\bFIRE[\s_-]*ALARM\b/i, "fire alarm"],

  // Viewport / layout
  [/\bVPORT\b/i, "viewport"],
  [/\bVIEWPORT\b/i, "viewport"],
  [/\bTITLE[\s_-]*BLOCK\b/i, "title block"],
  [/\bBORDER\b/i, "drawing border"],
  [/\bFRAME\b/i, "frame"],

  // Construction guidance layers (not physical quantity)
  [/\bGUIDE(LINE)?\b/i, "guide lines"],
  [/\bCONSTRUCTION\b/i, "construction aids"],
  [/\bHELP(ER)?\b/i, "helper geometry"],
  [/\bTEMP(ORARY)?\b/i, "temporary geometry"],

  // AP-level lines (common in UAE / GCC shop drawings)
  [/^AP[-_]/i, "AP level line prefix"],
  [/\bAP[\s_-]*LEVEL\b/i, "AP level line"],
];

/**
 * Returns true when the layer name matches a known noise pattern and should
 * be skipped by default.
 *
 * A saved *enabled* layer mapping always overrides this — the caller is
 * responsible for applying that logic.
 */
export function isNoiseLayer(layerName: string): boolean {
  const name = layerName.trim();
  return NOISE_PATTERNS.some(([re]) => re.test(name));
}

/**
 * Returns a human-readable reason why a layer was classified as noise,
 * or null if it is not noise.
 */
export function noiseLayerReason(layerName: string): string | null {
  const name = layerName.trim();
  for (const [re, reason] of NOISE_PATTERNS) {
    if (re.test(name)) return reason;
  }
  return null;
}
