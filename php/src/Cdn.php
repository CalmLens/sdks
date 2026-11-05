<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Transforms;
use CalmLens\Internal\Values;
use Psr\Http\Message\ResponseInterface;

final class Cdn extends Resource
{
    protected const OPERATIONS = 'cdn';

    /** The CDN resources a signed URL can be created for, as the API accepts them. */
    public const SIGNED_RESOURCES = ['original', 'rendered', 'preview', 'hls', 'embed'];

    /** Every CDN resource: the signed ones and the public `placeholder`. */
    public const RESOURCES = [...self::SIGNED_RESOURCES, 'placeholder'];

    /**
     * Where each resource is served beneath an asset's CDN path. The adaptive stream is its HLS
     * master playlist; its media playlists and segments are the other files beneath `hls/`.
     */
    private const RESOURCE_PATHS = ['original' => 'original', 'rendered' => 'rendered', 'preview' => 'preview',
        'hls' => 'hls/index.m3u8', 'embed' => 'embed', 'placeholder' => 'placeholder'];

    /**
     * The resources that take no lens or transform: the exact upload, the adaptive stream, the
     * embed page and the public placeholder.
     *
     * @internal
     */
    public const UNSELECTABLE_RESOURCES = ['original', 'hls', 'embed', 'placeholder'];

    /**
     * Builds a CDN URL for an asset's content, without a request.
     *
     * `resource` is `rendered` (default: the displayable file, an image in the best format the
     * client accepts, a PDF, or browser-safe video or audio), `original` (the exact upload),
     * `preview` (a still image for the asset), `hls` (the HLS master playlist of audio or video, at
     * `hls/index.m3u8`, once `content.hls` is set), `embed` (an
     * HTML page that shows the asset, a viewer for its type, for an iframe) or
     * `placeholder` (a small blurred PNG served publicly for every asset whatever its visibility or
     * moderation status). Lenses and transforms apply to `preview`, and to `rendered` when it is an
     * image; the CDN refuses them on rendered PDFs, video and audio with `transform/invalid`,
     * and the client refuses them on `original`, `hls`, `embed` and `placeholder`.
     *
     * `viewerClaims` takes `region` and `ageConfirmed`. `ageConfirmed` is your platform's
     * confirmation that the viewer passed its age check: your platform confirms the viewer's age,
     * and CalmLens does not verify this claim. Anyone requesting a public asset's URL can set it, so
     * it doesn't restrict access; to control who loads an age-restricted asset, make it private and
     * include the claim in a signed URL, whose signature covers it.
     *
     * @param array<string, mixed> $options assetIdentifier, resource, lens, transform and viewerClaims
     */
    public function getAssetUrl(array $options): string
    {
        Values::knownOptions($options, 'cdn.getAssetUrl');
        $resource = $options['resource'] ?? 'rendered';
        if (!in_array($resource, self::RESOURCES, true)) {
            Values::invalid('Resource must be one of ' . implode(', ', self::RESOURCES));
        }
        if (in_array($resource, self::UNSELECTABLE_RESOURCES, true) && (isset($options['lens']) || isset($options['transform']))) {
            Values::invalid("The $resource resource takes no lens or transform");
        }
        $url = $this->session->cdnBaseUrl . '/assets/' . Values::segment($this->session->projectId)
            . '/' . Values::segment($options['assetIdentifier'] ?? null) . '/' . self::RESOURCE_PATHS[$resource];
        // One path segment: the lens, then options that replace the lens's same-named options.
        $selector = [];
        if (isset($options['lens'])) {
            $selector[] = '@' . Values::segment($options['lens']);
        }
        if (isset($options['transform']) && $options['transform'] !== '') {
            $selector[] = Transforms::path($options['transform']);
        }
        if ($selector !== []) {
            $url .= '/' . implode(',', $selector);
        }
        // Opts a public age-restricted asset in to its public URL; only for viewers your app has
        // already decided may see age-restricted content. Without it, use a signed URL or the API key.
        $query = isset($options['viewerClaims'])
            ? ['viewerClaims' => json_encode(self::orderedClaims($options['viewerClaims']), JSON_THROW_ON_ERROR)]
            : [];
        return $query ? $url . '?' . http_build_query($query) : $url;
    }

    /** Returns a PSR-7 response with a streaming body; HTTP errors are returned, not thrown. */
    public function serve(array $options): ResponseInterface
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $init = $api['init'] ?? [];
        if (!is_array($init) || !is_array($init['headers'] ?? [])) {
            Values::invalid('init and headers must be arrays');
        }
        $method = strtoupper($init['method'] ?? 'GET');
        if (!in_array($method, ['GET', 'HEAD'], true)) {
            Values::invalid('CDN method must be GET or HEAD');
        }
        unset($api['init']);
        return $this->session->cdn($method, $this->getAssetUrl($api), $init['headers'] ?? [], $request);
    }

    /** Viewer claims in the order the other SDKs send them, so equal claims build equal CDN URLs. */
    private static function orderedClaims(mixed $claims): mixed
    {
        if (!is_array($claims)) {
            return $claims;
        }
        $ordered = [];
        foreach (['region', 'ageConfirmed'] as $key) {
            if (array_key_exists($key, $claims)) {
                $ordered[$key] = $claims[$key];
            }
        }
        return $ordered + $claims;
    }
}
