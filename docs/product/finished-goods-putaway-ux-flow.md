# Finished-goods putaway UX flow

This flow turns a completed finished-good LPN into one audited stock address.
It does not require rack or child-position setup for a general storage Area.

```mermaid
flowchart TD
  scan[Scan finished-good LPN] --> evidence{What size evidence exists?}

  evidence -->|Measured LPN| measured[Trusted footprint, height, and weight]
  evidence -->|Verified matching package profile| estimated[Estimated dimensions<br/>Medium confidence]
  evidence -->|No trusted evidence| unknown[Fit remains unknown<br/>Low confidence]

  measured --> hard[Apply hard filters]
  estimated --> hard
  unknown --> knownHard[Filter only known violations]

  hard --> eligible{Any eligible destination?}
  eligible -->|No| exception[FG staging or controlled exception<br/>Do not rank unsafe choices]
  eligible -->|Yes| rank[Rank: production order → customer order → customer → item/package → contiguous space → travel]

  knownHard --> fallback{Site permits visual-confirmation fallback?}
  fallback -->|No| measure[FG measurement staging<br/>Measure and rerun]
  fallback -->|Yes| low[Low-confidence general-Area suggestion<br/>Visual confirmation required]

  rank --> address{What address precision is required?}
  address -->|General Area| area[Scan Area<br/>No child setup required]
  address -->|Exact child| child[Area scan opens map/list<br/>Scan or choose exact position]

  estimated --> visual[Show evidence source<br/>Require visual confirmation]
  visual --> address
  low --> confirm[Operator visually confirms]
  confirm --> area

  area --> revalidate[Revalidate selected address]
  child --> revalidate
  revalidate --> override{Top recommendation selected?}
  override -->|Yes| post[Atomic ledger move + placement + audit]
  override -->|No| reason[Require override reason<br/>Preserve alternatives and confidence]
  reason --> post
```

## Decision rules

1. Hard constraints run before ranking: storage class, quality, prohibitions,
   lifecycle, physical fit, structural load, fire/access clearance, and fixture
   compatibility.
2. Ranking preferences never override a hard failure. Rank by the same
   production order, customer order, customer, item/package, reliable contiguous
   usable space, then travel and fragmentation.
3. Missing dimensions are not zero. A verified package profile permits only an
   estimated-fit claim; no trusted evidence means fit remains unknown.
4. A general storage Area is a valid stock address without child setup. An Area
   that enables exact addressing, or a rack/shelf leaf, requires one exact child
   before posting.
5. Confirmation revalidates the destination. Overrides preserve the original
   recommendation, alternatives, confidence, evidence, operator, and reason.
6. Every positive balance bucket for the handling unit moves to the selected
   stock address in the same transaction that writes placement and audit history.
