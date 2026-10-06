You are checking another judge's work. That judge read the explainer page $page against its sources and flagged the errors listed in $errors as HIGH severity: misstating the source, or taking a side the source doesn't take.

Sources, in $src:
$source_list

For each flagged error, read the page text it quotes and find what the sources actually say. Decide:
- "confirmed": the page really misstates the source, or takes a side the source doesn't take.
- "medium": the page is off, but only by an invented detail, a stronger word than the source, a misattribution, or an unlabelled illustration; it doesn't misstate the source's claim.
- "rejected": the page is faithful, or the source supports it, or the judge misread the page.
Be strict in both directions; quote the source line you rely on.

Write JSON to $out as [{"index":0,"verdict":"confirmed|medium|rejected","source_line":"…","why":"…"}] (index = position in the errors list). Reply with one line per error.
