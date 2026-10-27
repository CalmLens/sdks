package calmmarket;

import com.calmlens.Models;
import com.calmlens.Models.AssetModerationStatus;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Server-rendered HTML with no JavaScript or external assets: the market, a listing and the sell
 * form. Every dynamic value goes through {@link #h}.
 */
final class Page {
  private Page() {}

  private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault());

  private static final String STYLE = """
      :root{--bg:#f6f5f1;--surface:#fff;--line:#e3dfd5;--soft:#efece5;--text:#1e2730;--muted:#5b636b;--accent:#2d6a58;--accent-dark:#22513f;
      --ok:#21573f;--ok-bg:#e2f0e8;--wait:#33507a;--wait-bg:#e6ecf5;--bad:#8b3427;--bad-bg:#fae5e1;--off:#55504a;--off-bg:#ece8e0;
      font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text);background:var(--bg);line-height:1.5;font-size:15px}
      *{box-sizing:border-box}body{margin:0;background:var(--bg)}a{color:inherit}img{display:block}
      :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
      .top{background:var(--surface);border-bottom:1px solid var(--line)}.bar{max-width:1240px;margin:auto;padding:14px 24px;display:flex;align-items:center;gap:28px}
      .brand{font-weight:750;font-size:19px;letter-spacing:-.3px;text-decoration:none;display:flex;align-items:center;gap:9px}
      .brand svg{flex:none}.bar nav{display:flex;gap:20px;font-size:14px}.bar nav a{text-decoration:none;color:var(--muted)}.bar nav a:hover{color:var(--text)}
      .bar .button{margin-left:auto}
      .demo{background:var(--soft);border-bottom:1px solid var(--line);font-size:13px;color:var(--muted)}.demo p{max-width:1240px;margin:auto;padding:7px 24px}
      .button,button{display:inline-flex;align-items:center;justify-content:center;font:inherit;font-size:14px;font-weight:600;padding:9px 16px;border-radius:8px;
      border:1px solid var(--accent);background:var(--accent);color:#fff;text-decoration:none;cursor:pointer}.button:hover,button:hover{background:var(--accent-dark)}
      .button.secondary,button.secondary{background:var(--surface);color:var(--text);border-color:var(--line)}.button.secondary:hover,button.secondary:hover{background:var(--soft)}
      button.danger{background:var(--surface);color:var(--bad);border-color:#e6c4bd}button.danger:hover{background:var(--bad-bg)}
      .wrap{max-width:1240px;margin:auto;padding:28px 24px 56px}
      .notice{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:10px 14px;margin:0 0 22px;font-size:14px}
      h1{font-size:24px;letter-spacing:-.4px;margin:0;line-height:1.25}h2{font-size:16px;margin:0}h3{font-size:15px;margin:0}
      .meta{color:var(--muted);font-size:13px}
      .lower{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start;margin-top:36px}
      .head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:16px}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px}
      .card{display:block;text-decoration:none;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
      .card:hover{border-color:#cfc9bb}.card img,.card .ph{width:100%;aspect-ratio:3/2;object-fit:cover;background:var(--soft)}
      .card .body{padding:12px 14px 14px}.price{font-weight:700;font-size:17px}.card h3{font-weight:500;margin:2px 0 4px;overflow-wrap:anywhere}
      .empty{background:var(--surface);border:1px dashed var(--line);border-radius:12px;padding:40px 20px;text-align:center;color:var(--muted)}
      .empty p{margin:0 0 14px}
      .panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px}
      .panel .head{margin-bottom:6px}.panel .head a{font-size:14px;color:var(--accent);font-weight:600;text-decoration:none}
      .mine{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr) 112px;gap:8px 20px;align-items:center;border-top:1px solid var(--line);padding:14px 0}
      .mine:first-of-type{border-top:0}.mine:last-child{padding-bottom:0}.mine>.chip{justify-self:end}
      .mine>a{display:grid;grid-template-columns:52px minmax(0,1fr);gap:12px;align-items:center;text-decoration:none}.mine>a:hover strong{text-decoration:underline}
      .thumb{width:52px;height:52px;border-radius:8px;object-fit:cover;background:var(--soft)}
      .ph{display:flex;align-items:center;justify-content:center;color:#9a9286;background:var(--soft)}
      .mine>a strong{display:block;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .chip{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;white-space:nowrap}
      .ok{color:var(--ok);background:var(--ok-bg)}.wait{color:var(--wait);background:var(--wait-bg)}.bad{color:var(--bad);background:var(--bad-bg)}.off{color:var(--off);background:var(--off-bg)}
      .parts{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0}
      .parts li{font-size:12px;padding:2px 8px 2px 7px;border-radius:6px;border:1px solid var(--line);display:flex;align-items:center;gap:6px}
      .dot{width:7px;height:7px;border-radius:50%;flex:none;background:currentColor}
      .parts .ok,.parts .wait,.parts .bad,.parts .off{border-color:transparent}
      .reason{grid-column:1/-1;margin:2px 0 0 64px;padding:10px 12px;border-radius:8px;background:var(--bad-bg);color:#5b2219;font-size:13px}
      .reason p{margin:0}.reason .label{margin-top:8px;font-size:12px;font-weight:600}.gone{margin:0}.reason q{display:block;margin-top:6px;padding:6px 9px;background:var(--surface);border-radius:6px;color:var(--text);font-family:ui-monospace,Menlo,monospace;font-size:12px;quotes:none;overflow-wrap:anywhere}
      .activity{list-style:none;margin:8px 0 0;padding:0}.activity li{border-top:1px solid var(--line);padding:9px 0;font-size:13px}.activity li:first-child{border-top:0}
      .activity time{color:var(--muted);margin-right:6px}
      dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:1px 10px;margin:4px 0 0;color:var(--muted)}dl.facts dd{margin:0;overflow-wrap:anywhere}
      .sync{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}.sync .meta{margin:0}.sync button{white-space:nowrap}
      .back{display:inline-block;font-size:14px;color:var(--muted);text-decoration:none;margin-bottom:18px}.back:hover{color:var(--text)}
      .detail{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:36px;align-items:start}
      .gallery .main{width:100%;aspect-ratio:4/3;border-radius:12px;object-fit:cover;background:var(--soft)}
      .gallery .row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px}.gallery .row img,.gallery .row .ph{width:100%;aspect-ratio:4/3;border-radius:8px;object-fit:cover}
      .ph.large{aspect-ratio:4/3;border-radius:12px;font-size:14px}.gallery .row .ph{font-size:12px;text-align:center;padding:4px}
      .info .price{font-size:24px;margin:6px 0 2px}.info h1{margin-top:10px}.desc{white-space:pre-wrap;overflow-wrap:anywhere;margin:14px 0}
      .checks{list-style:none;margin:10px 0 0;padding:0}.checks>li{border-top:1px solid var(--line);padding:12px 0}.checks>li:last-child{padding-bottom:0}
      .check{display:flex;justify-content:space-between;align-items:center;gap:10px}.check span:first-child{font-weight:600;font-size:14px}
      .checks p{margin:6px 0 0;font-size:13px}.checks q{display:block;margin-top:6px;padding:7px 10px;background:var(--soft);border-radius:6px;font-family:ui-monospace,Menlo,monospace;font-size:12px;quotes:none;overflow-wrap:anywhere}
      details{margin-top:8px;font-size:13px}summary{cursor:pointer;color:var(--muted)}
      table{width:100%;border-collapse:collapse;margin-top:6px}td,th{text-align:left;padding:4px 0;border-top:1px solid var(--line);font-weight:400}td{text-align:right;font-variant-numeric:tabular-nums}
      .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:20px}.actions form{margin:0}
      .narrow{max-width:720px}.narrow h1{margin-bottom:4px}
      form.sell{margin-top:20px}.field{margin-bottom:18px}.field label,.field legend{display:block;font-size:14px;font-weight:600;margin-bottom:6px}
      .two{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:16px}
      input,select,textarea{font:inherit;width:100%;padding:9px 11px;border:1px solid #d6d0c3;border-radius:8px;background:var(--surface);color:var(--text)}
      textarea{min-height:120px;resize:vertical}.help{font-size:13px;color:var(--muted);margin-top:6px}
      fieldset{border:0;padding:0;margin:0 0 18px;min-width:0}fieldset>legend{font-size:14px;font-weight:600;padding:0;margin-bottom:6px}.slots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .slot{border:1px dashed #cfc8b9;border-radius:10px;padding:12px;background:#fbfaf7}.slot span{display:block;font-size:13px;font-weight:600;margin-bottom:8px}
      .slot input[type=file]{border:0;padding:0;background:none;font-size:13px;color:var(--muted)}
      .slot input[type=file]::file-selector-button{font:inherit;font-weight:600;margin-right:10px;padding:6px 12px;border-radius:7px;border:1px solid var(--line);background:var(--surface);color:var(--text);cursor:pointer}
      .slot select{margin-top:8px;font-size:13px;padding:6px 8px}
      .form-actions{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--line);padding-top:16px;margin-top:4px}
      @media(max-width:980px){.lower,.detail{grid-template-columns:1fr}.mine{grid-template-columns:minmax(0,1fr) auto}.mine>.parts,.mine>.gone{grid-column:1/-1;grid-row:2}}
      @media(max-width:560px){.bar{gap:14px;flex-wrap:wrap}.bar nav{order:3;width:100%}.two,.slots{grid-template-columns:1fr}.reason{margin-left:0}}
      .test-input{font-family:ui-monospace,Menlo,monospace;font-size:.9em;padding:0 5px;border-radius:4px;background:var(--wait-bg);color:var(--wait);white-space:nowrap}
      .visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
      """;

  /** A small mark next to the name: a price tag. */
  private static final String MARK = "<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect width=\"24\" height=\"24\" rx=\"6\" fill=\"#2d6a58\"/>"
      + "<path d=\"M7 7h5.2l5 5-5.2 5.2-5-5V7z\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.7\" stroke-linejoin=\"round\"/><circle cx=\"10\" cy=\"10\" r=\"1.2\" fill=\"#fff\"/></svg>";

  private static final String PHOTO_ICON = "<svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\">"
      + "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><circle cx=\"9\" cy=\"10\" r=\"1.6\"/><path d=\"M4 17l5-4.5 4 3.5 3-2.5 4 3.5\"/></svg>";

  // ---------------------------------------------------------------- Pages

  static String home(Calmmarket app, String notice, List<Calmmarket.Listing> market, List<Calmmarket.Listing> yours,
      List<Calmmarket.Activity> activity, boolean webhooks) {
    StringBuilder html = open(app, "Calmmarket");
    if (!notice.isEmpty()) notice(html, notice);
    html.append("<section aria-labelledby=\"market\"><div class=\"head\"><h1 id=\"market\">Fresh listings</h1><span class=\"meta\">")
        .append(market.size()).append(market.size() == 1 ? " item" : " items").append("</span></div>");
    if (market.isEmpty())
      html.append("<div class=\"empty\"><p>Nothing for sale yet. Listings appear here once they are approved.</p><a class=\"button\" href=\"/sell\">Sell an item</a></div>");
    else {
      html.append("<div class=\"grid\">");
      for (Calmmarket.Listing listing : market) listing.locked(() -> card(html, listing));
      html.append("</div>");
    }
    html.append("</section><div class=\"lower\">");

    html.append("<section class=\"panel\" id=\"yours\" aria-labelledby=\"yours-title\"><div class=\"head\"><h2 id=\"yours-title\">Your listings</h2>")
        .append("<a href=\"/sell\">New listing</a></div>");
    if (yours.isEmpty()) html.append("<p class=\"meta\">You haven't listed anything yet.</p>");
    // Listings that need the seller's attention come first. Each is rendered under its own lock,
    // so it is never seen half-updated.
    List<Calmmarket.Listing> ordered = yours.stream()
        .sorted(java.util.Comparator.comparingInt((Calmmarket.Listing listing) -> listing.locked(() -> attention(listing.state())))).toList();
    for (Calmmarket.Listing listing : ordered) listing.locked(() -> mine(html, listing));
    html.append("</section>");

    html.append("<section class=\"panel\" aria-labelledby=\"activity\"><h2 id=\"activity\">Activity</h2>");
    if (activity.isEmpty()) html.append("<p class=\"meta\">Nothing yet.</p>");
    else {
      html.append("<ol class=\"activity\">");
      for (Calmmarket.Activity entry : activity.subList(0, Math.min(8, activity.size()))) activity(html, entry);
      html.append("</ol>");
    }
    if (!app.demo())
      html.append("<div class=\"sync\"><p class=\"meta\">").append(webhooks ? "Webhooks deliver decisions as they happen." : "Decisions are pulled from the events feed.")
          .append("</p><form action=\"/reviews/sync\" method=\"post\">").append(csrf(app))
          .append("<button class=\"secondary\" type=\"submit\">Check now</button></form></div>");
    html.append("</section></div>");
    return close(html);
  }

  static String listing(Calmmarket app, String notice, Calmmarket.Listing listing) {
    StringBuilder html = open(app, listing.title + " · Calmmarket");
    html.append("<a class=\"back\" href=\"/\">← All listings</a>");
    if (!notice.isEmpty()) notice(html, notice);
    listing.locked(() -> { detail(html, app, listing); return null; });
    return close(html);
  }

  static String sell(Calmmarket app, String notice) {
    StringBuilder html = open(app, "Sell an item · Calmmarket");
    html.append("<div class=\"narrow\"><a class=\"back\" href=\"/\">← All listings</a>");
    if (!notice.isEmpty()) notice(html, notice);
    html.append("<h1>Sell an item</h1><p class=\"meta\">Your listing goes live once its title, description and photos are approved, including any text in the photos.</p>")
        .append("<form class=\"panel sell\" action=\"/listings\" method=\"post\" enctype=\"multipart/form-data\">").append(csrf(app))
        .append("<div class=\"field\"><label for=\"title\">Title</label><input id=\"title\" name=\"title\" required maxlength=\"").append(Calmmarket.MAX_TITLE)
        .append("\" placeholder=\"Oak side table\"></div>")
        .append("<div class=\"two\"><div class=\"field\"><label for=\"description\">Description</label><textarea id=\"description\" name=\"description\" required maxlength=\"")
        .append(Calmmarket.MAX_DESCRIPTION).append("\"></textarea></div>")
        .append("<div class=\"field\"><label for=\"price\">Price ($)</label><input id=\"price\" name=\"price\" required inputmode=\"decimal\" placeholder=\"25.00\"></div></div>");
    if (app.demo()) {
      html.append("<div class=\"field\"><label for=\"demo_text\">Demo result for the title and description</label><select id=\"demo_text\" name=\"demo_text\">");
      options(html, Calmmarket.DEMO_TEXT_RESULTS);
      html.append("</select></div>");
    }
    html.append("<fieldset><legend>Photos</legend><div class=\"slots\">");
    for (int number = 1; number <= Calmmarket.MAX_PHOTOS; number++) {
      html.append("<div class=\"slot\"><label for=\"photo").append(number).append("\"><span>").append(number == 1 ? "Cover photo" : "Photo " + number + " (optional)")
          .append("</span></label><input id=\"photo").append(number).append("\" name=\"photo").append(number).append("\" type=\"file\"").append(number == 1 ? " required" : "")
          .append(" accept=\"image/jpeg,image/png,image/gif,image/webp\">");
      if (app.demo()) {
        html.append("<label class=\"visually-hidden\" for=\"demo_photo").append(number).append("\">Demo result for photo ").append(number).append("</label>")
            .append("<select id=\"demo_photo").append(number).append("\" name=\"demo_photo").append(number).append("\">");
        options(html, Calmmarket.DEMO_PHOTO_RESULTS);
        html.append("</select>");
      }
      html.append("</div>");
    }
    html.append("</div><p class=\"help\">JPEG, PNG, GIF or WebP, up to 4 MB each. Photos stay private until they are approved.</p></fieldset>")
        .append("<div class=\"form-actions\"><a class=\"button secondary\" href=\"/\">Cancel</a><button type=\"submit\">Submit listing</button></div></form></div>");
    return close(html);
  }

  // ---------------------------------------------------------------- Pieces

  private static StringBuilder open(Calmmarket app, String title) {
    StringBuilder html = new StringBuilder(16384);
    html.append("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
        .append("<title>").append(attribute(title)).append("</title><style>").append(STYLE).append("</style></head><body>")
        .append("<header class=\"top\"><div class=\"bar\"><a class=\"brand\" href=\"/\">").append(MARK).append("Calmmarket</a>")
        .append("<nav aria-label=\"Main\"><a href=\"/\">Browse</a><a href=\"/#yours\">Your listings</a></nav>")
        .append("<a class=\"button\" href=\"/sell\">Sell an item</a></div></header>");
    if (app.demo())
      html.append("<div class=\"demo\"><p>Demo mode: moderation results are simulated and nothing is sent to CalmLens. Reports and photo text are synthetic.</p></div>");
    return html.append("<main class=\"wrap\">");
  }

  private static String close(StringBuilder html) {
    return html.append("</main></body></html>").toString();
  }

  private static void notice(StringBuilder html, String notice) {
    html.append("<p class=\"notice\" role=\"status\">").append(h(notice)).append("</p>");
  }

  private static StringBuilder card(StringBuilder html, Calmmarket.Listing listing) {
    Calmmarket.Photo cover = listing.photos.get(0);
    html.append("<a class=\"card\" href=\"/listings/").append(h(listing.id)).append("\"><img src=\"").append(photoUrl(listing, cover)).append("\" alt=\"\">")
        .append("<div class=\"body\"><div class=\"price\">$").append(h(listing.price)).append("</div><h3>").append(t(listing.title)).append("</h3>")
        .append("<div class=\"meta\">").append(photos(listing.photos.size())).append(" · Listed ").append(TIME.format(listing.createdAt)).append("</div></div></a>");
    return html;
  }

  /** One of the seller's listings: its state, each part's decision, and why a photo was held. */
  private static Void mine(StringBuilder html, Calmmarket.Listing listing) {
    Calmmarket.State state = listing.state();
    html.append("<article class=\"mine\"><a href=\"/listings/").append(h(listing.id)).append("\">");
    thumb(html, listing, "thumb");
    html.append("<span><strong>").append(t(listing.title)).append("</strong><span class=\"meta\">$").append(h(listing.price)).append(" · ")
        .append(photos(listing.photos.size())).append("</span></span></a>");
    if (state != Calmmarket.State.WITHDRAWN) {
      html.append("<ul class=\"parts\" aria-label=\"Checks for ").append(attribute(listing.title)).append("\">");
      for (Part part : parts(listing)) {
        html.append("<li class=\"").append(part.tone()).append("\"><span class=\"dot\" aria-hidden=\"true\"></span>").append(h(part.name()));
        if (part.tone().equals("ok")) html.append("<span class=\"visually-hidden\">: ").append(h(part.status())).append("</span>");
        else html.append(": ").append(h(part.status().toLowerCase(Locale.ROOT)));
        html.append("</li>");
      }
      html.append("</ul>");
    } else {
      html.append("<p class=\"meta gone\">")
          .append(listing.removalPending() ? "Some photos couldn't be deleted yet." : "Photos deleted. Moderation records are kept.").append("</p>");
    }
    html.append("<span class=\"chip ").append(tone(state)).append("\">").append(h(state.label)).append("</span>");
    if (state != Calmmarket.State.WITHDRAWN) {
      for (Calmmarket.Photo photo : listing.photos) {
        if (!photo.held()) continue;
        html.append("<div class=\"reason\"><p><strong>Photo ").append(photo.number).append(":</strong> ").append(h(reason(photo).toLowerCase(Locale.ROOT))).append("</p>");
        String text = extracted(photo);
        if (text != null) html.append("<p class=\"label\">Text found in the photo</p><q>").append(t(text)).append("</q>");
        html.append("</div>");
        break;
      }
    }
    html.append("</article>");
    return null;
  }

  private static void detail(StringBuilder html, Calmmarket app, Calmmarket.Listing listing) {
    Calmmarket.State state = listing.state();
    boolean showable = !listing.withdrawn && !listing.removed;
    html.append("<div class=\"detail\"><div class=\"gallery\">");
    Calmmarket.Photo cover = listing.cover();
    if (cover != null)
      html.append("<img class=\"main\" src=\"").append(photoUrl(listing, cover)).append("\" alt=\"").append(attribute(listing.title)).append("\">");
    else html.append("<div class=\"ph large\">").append(h(coverMessage(listing))).append("</div>");
    if (listing.photos.size() > 1) {
      html.append("<div class=\"row\">");
      for (Calmmarket.Photo photo : listing.photos) {
        if (showable && photo.allowed())
          html.append("<img src=\"").append(photoUrl(listing, photo)).append("\" alt=\"").append(attribute(listing.title)).append(", photo ").append(photo.number).append("\">");
        else html.append("<div class=\"ph\">Photo ").append(photo.number).append("<br>").append(h(photoStatus(photo, listing).toLowerCase(Locale.ROOT))).append("</div>");
      }
      html.append("</div>");
    }
    html.append("</div><div class=\"info\"><span class=\"chip ").append(tone(state)).append("\">").append(h(state.label)).append("</span>")
        .append("<h1>").append(t(listing.title)).append("</h1><div class=\"price\">$").append(h(listing.price)).append("</div>")
        .append("<p class=\"desc\">").append(t(listing.description)).append("</p>")
        .append("<p class=\"meta\">Listed ").append(TIME.format(listing.createdAt)).append(" · ").append(photos(listing.photos.size())).append("</p>");

    html.append("<section class=\"panel\" aria-labelledby=\"checks\"><div class=\"head\"><h2 id=\"checks\">Checks</h2><span class=\"meta\">")
        .append(h(summary(listing, state))).append("</span></div><ol class=\"checks\">");
    for (Part part : parts(listing)) {
      html.append("<li><div class=\"check\"><span>").append(h(part.name())).append("</span><span class=\"chip ").append(part.tone()).append("\">")
          .append(h(part.status())).append("</span></div>");
      if (part.photo() != null) photoDetail(html, app, listing, part.photo());
      html.append("</li>");
    }
    html.append("</ol></section><div class=\"actions\">");
    if (!listing.withdrawn || listing.removalPending())
      html.append("<form action=\"/listings/").append(h(listing.id)).append("/withdraw\" method=\"post\">").append(csrf(app))
          .append("<button class=\"danger\" type=\"submit\">").append(listing.withdrawn ? "Retry photo removal" : "Withdraw listing").append("</button></form>");
    if (app.demo() && state == Calmmarket.State.LIVE)
      html.append("<form action=\"/demo/review\" method=\"post\">").append(csrf(app))
          .append("<input type=\"hidden\" name=\"listing\" value=\"").append(h(listing.id)).append("\">")
          .append("<button class=\"secondary\" type=\"submit\">Simulate a reviewer rejecting photo 1</button></form>");
    if (listing.removalError != null) html.append("<span class=\"meta\">").append(h(listing.removalError)).append("</span>");
    else if (!listing.withdrawn) html.append("<span class=\"meta\">Withdrawing deletes the photos; moderation records are kept.</span>");
    html.append("</div></div></div>");
  }

  private static void photoDetail(StringBuilder html, Calmmarket app, Calmmarket.Listing listing, Calmmarket.Photo photo) {
    html.append("<p class=\"meta\">").append(t(photo.name)).append("</p>");
    if (photo.held()) html.append("<p>").append(h(reason(photo))).append("</p>");
    if (photo.reviewNote != null && !photo.reviewNote.isEmpty()) html.append("<p>Reviewer note: ").append(h(photo.reviewNote)).append("</p>");
    if (photo.refreshError != null) html.append("<p>").append(h(photo.refreshError)).append("</p>");
    switch (photo.ocr) {
      case FOUND -> {
        String text = extracted(photo);
        html.append("<p class=\"meta\">Text found in the photo").append(app.demo() ? " (synthetic)" : "").append("</p>");
        if (text != null) html.append("<q>").append(t(text)).append("</q>");
      }
      case NO_TEXT -> html.append("<p class=\"meta\">No text found in the photo</p>");
      default -> { }
    }
    if (listing.withdrawn) {
      String removal = photo.contentRemoved.containsAll(photo.contentIds()) ? "Photo deleted; its record and report are kept"
          : !photo.safetyHeld.isEmpty() ? "Kept under a safety hold" : "Not deleted yet";
      html.append("<p class=\"meta\">").append(removal).append("</p>");
    }
    List<Calmmarket.CategoryRow> rows = photo.categories();
    if (!rows.isEmpty()) {
      html.append("<details><summary>Moderation report").append(app.demo() ? " (synthetic)" : "").append("</summary><table><tbody>");
      for (Calmmarket.CategoryRow row : rows)
        html.append("<tr><th scope=\"row\">").append(h(row.label())).append("</th><td>").append(h(result(row.status(), row.score(), row.reason()))).append("</td></tr>");
      html.append("</tbody></table></details>");
    }
  }

  private static void activity(StringBuilder html, Calmmarket.Activity entry) {
    html.append("<li><time>").append(TIME.format(entry.at())).append("</time>").append(t(entry.text()));
    if (!entry.facts().isEmpty()) {
      html.append("<dl class=\"facts\">");
      for (Calmmarket.FactRow fact : entry.facts()) {
        html.append("<dt>").append(h(fact.label())).append("</dt><dd>");
        if (fact.url() != null) html.append("<a href=\"").append(h(fact.url())).append("\" rel=\"noopener noreferrer\">").append(h(fact.value())).append("</a>");
        else html.append(t(fact.value()));
        html.append("</dd>");
      }
      html.append("</dl>");
    }
    html.append("</li>");
  }

  private static void thumb(StringBuilder html, Calmmarket.Listing listing, String cssClass) {
    Calmmarket.Photo cover = listing.cover();
    if (cover != null) html.append("<img class=\"").append(cssClass).append("\" src=\"").append(photoUrl(listing, cover)).append("\" alt=\"\">");
    else html.append("<span class=\"").append(cssClass).append(" ph\">").append(PHOTO_ICON).append("</span>");
  }

  // ---------------------------------------------------------------- Words for decisions

  /** One moderated part of a listing (title, description or a photo) and its decision. */
  record Part(String name, String status, String tone, Calmmarket.Photo photo) {}

  static List<Part> parts(Calmmarket.Listing listing) {
    List<Part> parts = new ArrayList<>();
    for (String field : Calmmarket.TEXT_FIELDS.keySet()) {
      AssetModerationStatus status = listing.textStatus.get(field);
      String name = Character.toUpperCase(field.charAt(0)) + field.substring(1);
      parts.add(new Part(name, textStatus(status), status == null ? "off" : Calmmarket.Photo.shown(status) ? "ok" : "bad", null));
    }
    for (Calmmarket.Photo photo : listing.photos) {
      String tone = photo.allowed() ? "ok" : photo.held() || photo.refreshError != null ? "bad" : "wait";
      if (listing.withdrawn) tone = "off";
      parts.add(new Part("Photo " + photo.number, photoStatus(photo, listing), tone, photo));
    }
    return parts;
  }

  static String textStatus(AssetModerationStatus status) {
    if (status == null) return "Unknown";
    if (Calmmarket.Photo.shown(status)) return "Approved";
    if (status == AssetModerationStatus.PENDING) return "Checking";
    return "Rejected";
  }

  static String photoStatus(Calmmarket.Photo photo, Calmmarket.Listing listing) {
    if (listing.withdrawn) return photo.contentRemoved.containsAll(photo.contentIds()) ? "Deleted" : "Not deleted yet";
    if (photo.processingFailed()) return "Couldn't be checked";
    if (photo.refreshError != null) return "Couldn't refresh";
    if (!photo.decided()) return "Checking";
    if (photo.moderation == AssetModerationStatus.ALLOWED) return "Approved";
    if (photo.moderation == AssetModerationStatus.LIMITED) return "Approved, ranked lower";
    if (photo.moderation == AssetModerationStatus.PURGED) return "Removed";
    if (photo.moderation == AssetModerationStatus.AGE_RESTRICTED) return "Not allowed here";
    if (photo.moderation == AssetModerationStatus.BLOCKED) return "Rejected";
    return "On hold";
  }

  /** Why a held photo was held: the categories the policy acted on, or a reviewer's decision. */
  static String reason(Calmmarket.Photo photo) {
    if (photo.processingFailed()) return "The photo couldn't be processed. Try a different file.";
    if (photo.driver() == Calmmarket.Driver.REVIEWER) return "Rejected by a reviewer";
    if (photo.moderation == AssetModerationStatus.AGE_RESTRICTED) return "Age-restricted, which this marketplace doesn't show";
    List<String> flagged = photo.flagged().stream().map(key -> Calmmarket.CATEGORY_LABELS.getOrDefault(key, key)).toList();
    String what = photo.moderation == AssetModerationStatus.PURGED ? "Removed" : "Rejected";
    if (flagged.isEmpty()) return what + " by the moderation policy";
    return what + " for " + String.join(", ", flagged).toLowerCase(Locale.ROOT);
  }

  private static String summary(Calmmarket.Listing listing, Calmmarket.State state) {
    return switch (state) {
      case LIVE -> "Everything approved";
      case IN_REVIEW -> "Checking photos";
      case HELD -> "A photo wasn't approved";
      case REMOVED -> "Taken down after review";
      case WITHDRAWN -> "Withdrawn by you";
    };
  }

  private static String coverMessage(Calmmarket.Listing listing) {
    if (listing.withdrawn) return "Photos deleted";
    if (listing.removed) return "Taken down";
    return listing.state() == Calmmarket.State.IN_REVIEW ? "Photos are being checked" : "No approved photo";
  }

  /** Sort order for the seller's listings: held or taken down, then checking, live and withdrawn. */
  static int attention(Calmmarket.State state) {
    return switch (state) {
      case HELD, REMOVED -> 0;
      case IN_REVIEW -> 1;
      case LIVE -> 2;
      case WITHDRAWN -> 3;
    };
  }

  private static String tone(Calmmarket.State state) {
    return switch (state) {
      case LIVE -> "ok";
      case IN_REVIEW -> "wait";
      case HELD, REMOVED -> "bad";
      case WITHDRAWN -> "off";
    };
  }

  private static String extracted(Calmmarket.Photo photo) {
    Models.ExtractedText extracted = photo.extractedText;
    if (extracted == null || extracted.content() == null || extracted.content().isBlank()) return null;
    String text = extracted.content().strip().replaceAll("\\s+", " ");
    return text.length() > Calmmarket.MAX_EXTRACTED_TEXT_SHOWN ? text.substring(0, Calmmarket.MAX_EXTRACTED_TEXT_SHOWN) + "…" : text;
  }

  private static String photos(int count) { return count + (count == 1 ? " photo" : " photos"); }

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

  /** CalmLens text test inputs, after escaping: {@code <!calmlens-test <tag> <category>>}. */
  private static final java.util.regex.Pattern TEST_INPUT =
      java.util.regex.Pattern.compile("&lt;!calmlens-test\\s+[a-f0-9]{32}\\s+([a-z.-]+)\\s*&gt;", java.util.regex.Pattern.CASE_INSENSITIVE);

  /**
   * User text for display: escaped, with each CalmLens test input shown as a short marker
   * ("test input: criminal-activity") instead of its tag.
   */
  static String t(String value) {
    return TEST_INPUT.matcher(h(value)).replaceAll(match -> "<span class=\"test-input\">test input: " + match.group(1).toLowerCase(Locale.ROOT) + "</span>");
  }

  /** User text for an attribute or the document title: escaped, with test inputs as plain markers. */
  static String attribute(String value) {
    return TEST_INPUT.matcher(h(value)).replaceAll(match -> "test input: " + match.group(1).toLowerCase(Locale.ROOT));
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
