---
status: accepted
---

# Bounded contextual location inference

When an itinerary item omits a location, the system may infer the most specific geographic level supported by a bounded neighborhood of itinerary context, including the prior night's lodging and nearby items across adjacent date sections. It must preserve explicit locations, select only from the versioned Location Registry, retain provenance and evidence references, and leave the item unresolved when candidates conflict; existing data requires an explicit context-aware maintenance operation rather than silently invoking an LLM during ordinary normalization.
