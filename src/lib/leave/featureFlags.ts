// Deliberate, easily-reversible product toggles for the Leave module - not
// removals. Flip back to true to bring a hidden feature back; the
// underlying type fields, API persistence and data keep working either way.

// The "Handover to" person picker (separate from OD's own Place of
// Visit/Point of Contact fields) - hidden pending a product decision on
// whether it's still needed now that every leave type carries its own
// point-of-contact field.
export const HANDOVER_ENABLED = false;
