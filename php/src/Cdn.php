<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Transforms;
use CalmLens\Internal\Values;
use Psr\Http\Message\ResponseInterface;

final class Cdn extends Resource
{
    public function getAssetUrl(array $options): string
    {
        $resource = $options['resource'] ?? 'content';
        if (!in_array($resource, ['content', 'preview'], true)) {
            Values::invalid('Resource must be content or preview');
        }
        $url = $this->session->cdnBaseUrl . '/assets/' . Values::segment($this->session->projectId)
            . '/' . Values::segment($options['assetIdentifier'] ?? null) . '/' . $resource;
        if (isset($options['lens'])) {
            $url .= '/@' . Values::segment($options['lens']);
        }
        if (isset($options['transform']) && $options['transform'] !== '') {
            $url .= (isset($options['lens']) ? ',' : '/') . Transforms::path($options['transform']);
        }
        // Opts a public age-restricted asset in to its public URL; only for viewers your app has
        // already decided may see age-restricted content. Without it, use a signed URL or the API key.
        $ageRestricted = $options['ageRestricted'] ?? false;
        if (!is_bool($ageRestricted)) {
            Values::invalid('ageRestricted must be true or false');
        }
        return $ageRestricted ? $url . '?ageRestricted=true' : $url;
    }

    /** Returns a PSR-7 response with a streaming body; HTTP errors are returned, not thrown. */
    public function serve(array $options): ResponseInterface
    {
        [$api, $request] = $this->split($options);
        $init = $api['init'] ?? [];
        if (!is_array($init) || !is_array($init['headers'] ?? [])) {
            Values::invalid('init and headers must be arrays');
        }
        $method = strtoupper($init['method'] ?? 'GET');
        if (!in_array($method, ['GET', 'HEAD'], true)) {
            Values::invalid('CDN method must be GET or HEAD');
        }
        return $this->session->cdn($method, $this->getAssetUrl($api), $init['headers'] ?? [], $request);
    }
}
