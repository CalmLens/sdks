import { getAssetUrl } from "@calmlens/sdk/app";

type SensitiveImageProps = {
  projectId: string;
  assetId: string;
  status: "allowed" | "age-restricted";
  canView: boolean;
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
  canView,
  alt,
  aspectRatio,
  onReveal,
}: SensitiveImageProps) {
  const restricted = status === "age-restricted";
  const asset = { projectId, assetIdentifier: assetId };
  return (
    <figure style={{ aspectRatio, margin: 0, position: "relative" }}>
      {!restricted || canView ? (
        <img src={getAssetUrl({ ...asset, ageRestricted: restricted })} alt={alt} style={fill} />
      ) : (
        <>
          <img src={getAssetUrl({ ...asset, resource: "placeholder" })} alt="" style={fill} />
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
