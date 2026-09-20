---
status: accepted
---

# Use date-first Document Context for itinerary extraction

Itinerary imports will derive a deterministic Document Context before LLM extraction, using date-bearing sections as the primary grouping boundary. Each Chunk inherits its Date Section context until the next Markdown heading; a heading without a date starts an undated section. An explicit item-level or cross-day date may override a dated section default and retain its Date Provenance; content outside any Date Section remains undated rather than receiving the runtime date. This preserves human date-oriented reading, prevents context loss when sections are split, and avoids sending the entire document to every provider call.
