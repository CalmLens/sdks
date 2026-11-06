import { CalmLensAppClient } from "calmlens/app";

// Builds public CDN URLs without a request or an API key.
const calmlens = new CalmLensAppClient({ uploadPresetId: "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P" });

type SensitiveImageProps = {
  projectId: string;
  assetId: string;
  status: "allowed" | "limited" | "age-restricted";
  ageConfirmed: boolean;
  alt: string;
  /** Width divided by height, which you store when the image is uploaded. */
  aspectRatio: number;
  onReveal: () => void;
};

const fill = { width: "100%", height: "100%", objectFit: "cover" } as const;

export function SensitiveImage({
  projectId,
  assetId,
  status,
  ageConfirmed,
  alt,
  aspectRatio,
  onReveal,
}: SensitiveImageProps) {
  const restricted = status === "age-restricted";
  const asset = { projectId, assetId };
  return (
    <figure style={{ aspectRatio, margin: 0, position: "relative" }}>
      {!restricted || ageConfirmed ? (
        <img
          // Claims make the response private and uncacheable: send them only when needed.
          src={calmlens.cdn.getAssetUrl({
            ...asset,
            resource: "rendered",
            ...(restricted ? { viewerClaims: { ageConfirmed } } : {}),
          })}
          alt={alt}
          style={fill}
        />
      ) : (
        <>
          <img
            src={calmlens.cdn.getAssetUrl({ ...asset, resource: "placeholder" })}
            alt=""
            style={fill}
          />
          <figcaption
            style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center" }}
          >
            Sensitive content{" "}
            <button type="button" onClick={onReveal}>
              View
            </button>
          </figcaption>
        </>
      )}
    </figure>
  );
}
