package calmmarket;

import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import com.calmlens.Models;

/** Server-rendered HTML with no JavaScript or external assets. Every dynamic value goes through {@link #h}. */
final class Page {
  private Page() {}

  private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault());

  private static final String STYLE = """
      :root{font-family:system-ui,sans-serif;color:#26313f;background:#f6f4ef;line-height:1.55}*{box-sizing:border-box}body{margin:0}
      main{max-width:1180px;margin:auto;padding:36px 20px}header{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid #e0dacd;padding-bottom:20px}
      .wordmark{font-size:22px;font-weight:750;letter-spacing:-.5px}.mode,.badge{display:inline-block;padding:4px 11px;border-radius:30px;background:#ebe5d8;font-size:12px;font-weight:650}
      h1{font-size:clamp(30px,5vw,48px);line-height:1.1;letter-spacing:-1.5px;margin:30px 0 10px}.intro{max-width:660px;color:#62696f}
      .notice{background:#fff;border:1px solid #e0dacd;border-left:4px solid #b9772a;border-radius:10px;padding:12px 16px;margin-top:22px}
      .layout{display:grid;grid-template-columns:320px 1fr;gap:26px;margin-top:28px}.panel,.card{background:#fff;border:1px solid #e0dacd;border-radius:16px;padding:20px}
      .panel{align-self:start}h2{font-size:18px;margin:0 0 14px}label{display:block;font-size:14px;font-weight:650;margin:12px 0 6px}
      input,select,textarea,button{font:inherit;width:100%;padding:10px;border-radius:9px}input,select,textarea{border:1px solid #cfc7b6;background:#fffdf8}textarea{min-height:110px;resize:vertical}
      button{border:0;background:#2f6d5b;color:#fff;font-weight:650;cursor:pointer;margin-top:16px}button:hover{background:#245446}button.secondary{background:#ebe5d8;color:#26313f;margin-top:10px}
      :focus-visible{outline:3px solid #b9772a;outline-offset:2px}.hint,small{font-size:12px;color:#62696f}
      .market{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{padding:12px}.card img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;background:#efe9dc}
      .card h3{font-size:16px;margin:10px 0 2px;overflow-wrap:anywhere}.price{font-weight:700}.card p{font-size:14px;color:#454c55;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}
      .flagged{background:#fff0cc;color:#6b5013}.live{background:#dcefe5;color:#24573f}.held{background:#fbe1df;color:#8a3a31}.in-review{background:#e2e8f3;color:#344e78}
      table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px 6px;border-top:1px solid #eee7d9;vertical-align:top}td form button{margin:0;padding:6px 10px;width:auto}
      .empty{text-align:center;color:#62696f;padding:48px 16px;grid-column:1/-1}section{margin-top:24px}ol{list-style:none;padding:0;margin:0}ol li{border-top:1px solid #eee7d9;padding:8px 0;font-size:14px}
      dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;margin:6px 0 0;font-size:12px;color:#62696f}dd{margin:0;overflow-wrap:anywhere}
      fieldset{border:1px solid #e0dacd;border-radius:10px;margin:12px 0 0;padding:8px 12px 12px}legend{font-size:14px;font-weight:650;padding:0 4px}
      .visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.thumbs{display:flex;gap:6px;margin-top:6px}.thumbs img{width:64px;aspect-ratio:1;object-fit:cover;border-radius:6px}
      .listing{border-top:1px solid #eee7d9;padding:14px 0}.listing .row{display:flex;justify-content:space-between;gap:10px;align-items:center}.listing h3{font-size:16px;margin:0;overflow-wrap:anywhere}
      .photo{display:flex;gap:12px;margin-top:12px}.photo img{width:96px;height:72px;object-fit:cover;border-radius:8px;flex:none}.photo>div{flex:1;min-width:0}
      q{display:block;font-style:italic;color:#454c55;overflow-wrap:anywhere}details{margin-top:6px;font-size:13px}summary{cursor:pointer;font-weight:650}details th[scope=row]{font-weight:500}
      @media(max-width:860px){.layout{grid-template-columns:1fr}}@media(max-width:520px){.market{grid-template-columns:1fr}header{flex-direction:column;align-items:flex-start}}
      """;

  static String render(Calmmarket app, String notice, List<Calmmarket.Listing> listings, List<Calmmarket.Activity> activity, boolean webhooks) {
    StringBuilder html = new StringBuilder(16384);
    html.append("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
        .append("<title>Calmmarket · Java SDK example</title><style>").append(STYLE).append("</style></head><body><main>")
        .append("<header><div class=\"wordmark\">◫ Calmmarket</div><span class=\"mode\">")
        .append(app.demo() ? "Demo · simulated decisions" : "Live · CalmLens moderation").append("</span></header>")
        .append("<h1>Read the whole photo,<br>not just the pixels.</h1><p class=\"intro\">Sellers put prices, slogans, phone numbers and claims inside their photos. ")
        .append("Every photo is uploaded with OCR, so the text in it is moderated too. A listing goes live only when its title, its description and every photo are approved. ")
        .append("A small, working example of the CalmLens Java SDK.</p>");
    if (!notice.isEmpty()) html.append("<p class=\"notice\" role=\"status\">").append(h(notice)).append("</p>");

    html.append("<div class=\"layout\"><form class=\"panel\" action=\"/listings\" method=\"post\" enctype=\"multipart/form-data\"><h2>Sell an item</h2>")
        .append(csrf(app))
        .append("<label for=\"title\">Title</label><input id=\"title\" name=\"title\" required maxlength=\"").append(Calmmarket.MAX_TITLE).append("\">")
        .append("<label for=\"description\">Description</label><textarea id=\"description\" name=\"description\" required maxlength=\"").append(Calmmarket.MAX_DESCRIPTION).append("\"></textarea>")
        .append("<label for=\"price\">Price</label><input id=\"price\" name=\"price\" required inputmode=\"decimal\" placeholder=\"25.00\">");
    if (app.demo()) {
      html.append("<label for=\"demo_text\">Demo result for the text</label><select id=\"demo_text\" name=\"demo_text\">");
      options(html, Calmmarket.DEMO_TEXT_RESULTS);
      html.append("</select>");
    }
    for (int number = 1; number <= Calmmarket.MAX_PHOTOS; number++) {
      html.append("<fieldset><legend>Photo ").append(number).append(number == 1 ? "" : " (optional)").append("</legend>")
          .append("<label for=\"photo").append(number).append("\" class=\"visually-hidden\">Photo ").append(number).append(" file</label>")
          .append("<input id=\"photo").append(number).append("\" name=\"photo").append(number).append("\" type=\"file\"").append(number == 1 ? " required" : "")
          .append(" accept=\"image/jpeg,image/png,image/gif,image/webp\">");
      if (app.demo()) {
        html.append("<label for=\"demo_photo").append(number).append("\">Demo result</label><select id=\"demo_photo").append(number)
            .append("\" name=\"demo_photo").append(number).append("\">");
        options(html, Calmmarket.DEMO_PHOTO_RESULTS);
        html.append("</select>");
      }
      html.append("</fieldset>");
    }
    html.append("<p class=\"hint\">JPEG, PNG, GIF, or WebP, up to 4MiB each. Photos stay private until approved, and the text in them is read and moderated.</p>");
    if (app.demo())
      html.append("<p class=\"hint\">Demo mode uses the SDK's offline mock with the results you choose. Reports and OCR text are synthetic. Nothing is classified.</p>");
    html.append("<button type=\"submit\">Submit for review</button></form><div>");

    html.append("<section aria-labelledby=\"market\" style=\"margin-top:0\"><h2 id=\"market\">On the market</h2><div class=\"market\">");
    List<Calmmarket.Listing> visible = listings.stream().filter(listing -> listing.locked(listing::visible)).toList();
    if (visible.isEmpty()) html.append("<p class=\"empty\">No approved listings yet.</p>");
    for (Calmmarket.Listing listing : visible) listing.locked(() -> card(html, app, listing));
    html.append("</div></section>");

    html.append("<section class=\"panel\" aria-labelledby=\"yours\"><h2 id=\"yours\">Your listings</h2>");
    if (listings.isEmpty()) html.append("<p class=\"hint\">Nothing submitted yet.</p>");
    // Each listing is rendered under its own lock, so it is never seen half-updated.
    for (Calmmarket.Listing listing : listings) listing.locked(() -> { listing(html, app, listing); return null; });
    html.append("</section>");

    html.append("<section class=\"panel\" aria-labelledby=\"activity\"><h2 id=\"activity\">Review activity</h2>");
    if (!app.demo())
      html.append("<form action=\"/reviews/sync\" method=\"post\">").append(csrf(app))
          .append("<button class=\"secondary\" type=\"submit\">Check for review decisions</button></form>")
          .append("<p class=\"hint\">").append(webhooks ? "Verified webhooks at /webhooks/calmlens also apply decisions." : "Set CALMLENS_WEBHOOK_SECRET to receive webhooks.").append("</p>");
    if (activity.isEmpty()) html.append("<p class=\"hint\">No activity yet.</p>");
    else {
      html.append("<ol>");
      for (Calmmarket.Activity entry : activity) {
        html.append("<li><small>").append(TIME.format(entry.at())).append("</small> ").append(h(entry.text()));
        if (!entry.facts().isEmpty()) {
          html.append("<dl>");
          for (Calmmarket.FactRow fact : entry.facts()) {
            html.append("<dt>").append(h(fact.label())).append("</dt><dd>");
            if (fact.url() != null) html.append("<a href=\"").append(h(fact.url())).append("\" rel=\"noopener noreferrer\">").append(h(fact.value())).append("</a>");
            else html.append(h(fact.value()));
            html.append("</dd>");
          }
          html.append("</dl>");
        }
        html.append("</li>");
      }
      html.append("</ol>");
    }
    html.append("</section></div></div><footer class=\"hint\" style=\"margin-top:28px\">A local, single-user learning example. State resets on restart.</footer></main></body></html>");
    return html.toString();
  }

  private static StringBuilder card(StringBuilder html, Calmmarket app, Calmmarket.Listing listing) {
    html.append("<article class=\"card\"><img src=\"").append(photoUrl(listing, listing.photos.get(0))).append("\" alt=\"").append(h(listing.title)).append("\">")
        .append("<h3>").append(h(listing.title)).append("</h3><div class=\"price\">$").append(h(listing.price)).append("</div>")
        .append("<p>").append(h(listing.description)).append("</p>");
    if (listing.photos.size() > 1) {
      html.append("<div class=\"thumbs\">");
      for (Calmmarket.Photo photo : listing.photos.subList(1, listing.photos.size()))
        html.append("<img src=\"").append(photoUrl(listing, photo)).append("\" alt=\"").append(h(listing.title)).append(", photo ").append(photo.number).append("\">");
      html.append("</div>");
    }
    if (listing.flagged) html.append("<span class=\"badge flagged\">Text flagged for review</span>");
    if (app.demo())
      html.append("<form action=\"/demo/review\" method=\"post\">").append(csrf(app))
          .append("<input type=\"hidden\" name=\"listing\" value=\"").append(h(listing.id)).append("\">")
          .append("<button class=\"secondary\" type=\"submit\">Simulate a reviewer rejecting photo 1</button></form>");
    return html.append("</article>");
  }

  private static void listing(StringBuilder html, Calmmarket app, Calmmarket.Listing listing) {
    Calmmarket.State state = listing.state();
    String tone = switch (state) {
      case LIVE -> "live";
      case IN_REVIEW -> "in-review";
      default -> "held";
    };
    html.append("<article class=\"listing\"><div class=\"row\"><h3>").append(h(listing.title)).append("</h3><span class=\"badge ").append(tone).append("\">")
        .append(h(state.label)).append("</span></div>");
    if (listing.withdrawn) {
      html.append("<p class=\"hint\">Stored photo content is removed with deleteContent. The asset records and reports remain for audit.</p>");
      if (listing.removalError != null) html.append("<p class=\"hint\">").append(h(listing.removalError)).append("</p>");
    }
    for (Calmmarket.Photo photo : listing.photos) photo(html, app, listing, photo);
    if (!listing.withdrawn || listing.removalPending())
      html.append("<form action=\"/listings/").append(h(listing.id)).append("/withdraw\" method=\"post\">").append(csrf(app))
          .append("<button class=\"secondary\" type=\"submit\">").append(listing.withdrawn ? "Retry removal" : "Withdraw listing").append("</button></form>");
    html.append("</article>");
  }

  private static void photo(StringBuilder html, Calmmarket app, Calmmarket.Listing listing, Calmmarket.Photo photo) {
    String decision = photo.decision();
    html.append("<div class=\"photo\">");
    if (photo.approved() && !listing.withdrawn && !listing.removed)
      html.append("<img src=\"").append(photoUrl(listing, photo)).append("\" alt=\"Photo ").append(photo.number).append(" of ").append(h(listing.title)).append("\">");
    html.append("<div><strong>Photo ").append(photo.number).append("</strong> <small>").append(h(photo.name)).append("</small>")
        .append("<dl><dt>Combined decision</dt><dd>").append(h(decision)).append("</dd>");
    if (photo.refreshError != null) html.append("<dt>Refresh</dt><dd>").append(h(photo.refreshError)).append("</dd>");
    html.append("<dt>Text in photo</dt><dd>");
    switch (photo.ocr) {
      case FOUND -> {
        Models.Asset child = photo.textChild;
        Models.AssetModerationStatus childStatus = Calmmarket.moderationStatus(child);
        html.append("Found · OCR text asset ").append(h(childStatus == null ? "unknown" : childStatus.value()));
        Models.ExtractedText extracted = child.content() == null ? null : child.content().extractedText();
        if (extracted != null && extracted.content() != null) {
          String text = extracted.content();
          if (text.length() > Calmmarket.MAX_EXTRACTED_TEXT_SHOWN) text = text.substring(0, Calmmarket.MAX_EXTRACTED_TEXT_SHOWN) + "…";
          html.append("<q>").append(h(text)).append("</q>");
        }
      }
      case NO_TEXT -> html.append("No text found (no OCR child)");
      case LOOKUP_FAILED -> html.append("Could not be loaded");
      default -> html.append("Checked once a decision arrives");
    }
    html.append("</dd>");
    if (photo.driver() != Calmmarket.Driver.NONE) html.append("<dt>Rejected because of</dt><dd>").append(h(photo.driver().label)).append("</dd>");
    if (photo.rejectionNote != null && !photo.rejectionNote.isEmpty()) html.append("<dt>Note</dt><dd>").append(h(photo.rejectionNote)).append("</dd>");
    if (listing.withdrawn) {
      String removal = photo.contentRemoved.containsAll(photo.contentIds()) ? "Removed"
          : !photo.safetyHeld.isEmpty() ? "Kept under a safety hold" : "Not removed yet";
      html.append("<dt>Stored content</dt><dd>").append(removal).append("</dd>");
    }
    html.append("</dl>");
    List<Calmmarket.CategoryRow> rows = photo.categories();
    if (!rows.isEmpty()) {
      html.append("<details><summary>Report categories").append(app.demo() ? " (synthetic)" : "").append("</summary><table><thead><tr>")
          .append("<th scope=\"col\">Category</th><th scope=\"col\">Combined</th><th scope=\"col\">Text in photo</th><th scope=\"col\">From</th></tr></thead><tbody>");
      for (Calmmarket.CategoryRow row : rows)
        html.append("<tr><th scope=\"row\">").append(h(row.label())).append("</th><td>").append(h(result(row.status(), row.score(), row.reason())))
            .append("</td><td>").append(h(photo.ocr == Calmmarket.Ocr.FOUND ? result(row.textStatus(), row.textScore(), null) : "—"))
            .append("</td><td>").append(h(row.source().label)).append("</td></tr>");
      html.append("</tbody></table></details>");
    }
    html.append("</div></div>");
  }

  /** A category result in words. Not evaluated is shown as such, never as a zero score. */
  static String result(String status, Double score, String reason) {
    if (status == null) return "—";
    if (score != null) return String.format(Locale.ROOT, "%.2f", score) + ("partial".equals(status) ? " (partial)" : "");
    if ("not-evaluated".equals(status)) return "Not evaluated" + (reason == null ? "" : " (" + reason + ")");
    return "No score";
  }

  private static String photoUrl(Calmmarket.Listing listing, Calmmarket.Photo photo) {
    return "/listings/" + h(listing.id) + "/photos/" + photo.number;
  }

  private static void options(StringBuilder html, Map<String, String> values) {
    for (Map.Entry<String, String> value : values.entrySet())
      html.append("<option value=\"").append(h(value.getKey())).append("\">").append(h(value.getValue())).append("</option>");
  }

  private static String csrf(Calmmarket app) {
    return "<input type=\"hidden\" name=\"csrf\" value=\"" + h(app.csrf) + "\">";
  }

  static String h(String value) {
    StringBuilder out = new StringBuilder(value.length() + 16);
    for (char c : value.toCharArray()) {
      switch (c) {
        case '&' -> out.append("&amp;");
        case '<' -> out.append("&lt;");
        case '>' -> out.append("&gt;");
        case '"' -> out.append("&quot;");
        case '\'' -> out.append("&#39;");
        default -> out.append(c);
      }
    }
    return out.toString();
  }
}
