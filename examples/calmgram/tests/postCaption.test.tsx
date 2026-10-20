import { expect, test } from "bun:test";
import { PostCaption } from "../src/views";

test("prefills the caption as escaped text and limits its length", () => {
  const html = <PostCaption prefill={"hello & </textarea><script>alert(1)</script>"} />;
  expect(html.toString()).toContain(
    "hello &amp; &lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
  );
  expect((<PostCaption prefill={"x".repeat(2201)} />).toString()).toContain(
    `>${"x".repeat(2200)}</textarea>`,
  );
  expect((<PostCaption prefill={"x".repeat(2201)} />).toString()).not.toContain("x".repeat(2201));
});

test("preserves a failed submission's draft ahead of an incoming prefill", () => {
  expect((<PostCaption draft="retry draft" prefill="link draft" />).toString()).toContain(
    ">retry draft</textarea>",
  );
  expect((<PostCaption draft="" prefill="link draft" />).toString()).not.toContain("link draft");
});
