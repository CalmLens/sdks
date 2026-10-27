import { expect, test } from "bun:test";
import { isVisibleTo, postMediaFor, type Viewer } from "../src/content";
import type { Env, Post } from "../src/data";
import { PostCard } from "../src/views";

// Live mode builds real CDN URLs locally with the SDK; nothing here makes a request.
const env = {
  CALMLENS_API_KEY: "sk_test_key",
  CALMLENS_PROJECT_ID: "project-1",
  CALMLENS_CDN_URL: "https://cdn.example.test/v1",
} as unknown as Env;

const ASSET = "https://cdn.example.test/v1/assets/project-1/asset-1";

const post = (status: Post["status"]): Post => ({
  id: "p1",
  author: "misty_heron_42",
  caption: "Evening swim",
  createdAt: 0,
  assetId: "asset-1",
  status,
  findings: [{ category: "sexual", score: 0.95 }],
  checkedAt: 0,
});

const viewer = (showSensitiveMedia: boolean): Viewer => ({
  username: "calm_otter_7",
  showSensitiveMedia,
});

/** What a rendered card exposes: image sources, figures by accessible name, and links. */
const inspect = async (html: string) => {
  const images: string[] = [];
  const figures: string[] = [];
  const links: string[] = [];
  await new HTMLRewriter()
    .on("img", { element: (el) => void images.push(el.getAttribute("src") ?? "") })
    .on("figure", { element: (el) => void figures.push(el.getAttribute("aria-label") ?? "") })
    .on("a", { element: (el) => void links.push(el.getAttribute("href") ?? "") })
    .transform(new Response(html))
    .text();
  return { images, figures, links };
};

const renderCard = (status: Post["status"], viewing: Viewer | null) => {
  const media = postMediaFor(env, post(status), "feed", viewing);
  return inspect(
    (
      <PostCard
        post={post(status)}
        imageUrl={media.url}
        placeholderUrl={media.placeholderUrl}
        comments={[]}
        likes={[]}
        viewer={viewing?.username ?? null}
      />
    ).toString(),
  );
};

test("shows an age-restricted photo's placeholder and a sensitive-content notice while the setting is off", async () => {
  expect(postMediaFor(env, post("age-restricted"), "feed", viewer(false))).toEqual({
    url: null,
    placeholderUrl: `${ASSET}/placeholder`,
  });
  const card = await renderCard("age-restricted", viewer(false));
  expect(card.images).toEqual([`${ASSET}/placeholder`]);
  expect(card.figures).toContain("Sensitive content");
  expect(card.links).toContain("/u/calm_otter_7#sensitive-media");
});

test("opts in to an age-restricted photo for a viewer who turned on sensitive media", async () => {
  const media = postMediaFor(env, post("age-restricted"), "feed", viewer(true));
  expect(media).toEqual({
    url: `${ASSET}/rendered/@calmgram-feed?ageConfirmed=true`,
    placeholderUrl: null,
  });
  const card = await renderCard("age-restricted", viewer(true));
  expect(card.images).toEqual([`${ASSET}/rendered/@calmgram-feed?ageConfirmed=true`]);
  expect(card.figures).not.toContain("Sensitive content");
});

test("always gives signed-out viewers the placeholder, with no settings link", async () => {
  expect(postMediaFor(env, post("age-restricted"), "thumb", null)).toEqual({
    url: null,
    placeholderUrl: `${ASSET}/placeholder`,
  });
  const card = await renderCard("age-restricted", null);
  expect(card.images).toEqual([`${ASSET}/placeholder`]);
  expect(card.figures).toContain("Sensitive content");
  expect(card.links.some((href) => href.includes("#sensitive-media"))).toBe(false);
});

test("publishes allowed, limited and age-restricted posts but keeps blocked and purged ones from other viewers", () => {
  expect(isVisibleTo(post("age-restricted"), null)).toBe(true);
  for (const status of ["blocked", "purged", "pending", "error"] as const) {
    expect(isVisibleTo(post(status), "someone_else")).toBe(false);
    expect(isVisibleTo(post(status), "misty_heron_42")).toBe(true);
    expect(postMediaFor(env, post(status), "feed", viewer(true))).toEqual({
      url: null,
      placeholderUrl: null,
    });
  }
  // Allowed and limited photos never carry the opt-in, whatever the viewer's setting.
  for (const status of ["allowed", "limited"] as const) {
    expect(isVisibleTo(post(status), null)).toBe(true);
    expect(postMediaFor(env, post(status), "thumb", viewer(true))).toEqual({
      url: `${ASSET}/rendered/@calmgram-thumb`,
      placeholderUrl: null,
    });
  }
});
