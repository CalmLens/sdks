<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Transforms;
use CalmLens\Internal\Values;
use Psr\Http\Message\ResponseInterface;

/**
 * Builds asset URLs, signs private assets' URLs, reads an asset URL's display info and fetches
 * CDN content.
 *
 * Every asset has one URL, `{cdnBaseUrl}/assets/{projectId}/{asset}`, and each resource is a path
 * beneath it. The asset segment is the asset ID, or `ext:` and the URL-encoded external ID, for a
 * public asset, or a signed grant for a private one: use `signAssetUrl` if the asset is private,
 * `getAssetUrl` otherwise, and add viewer claims to either.
 *
 * @phpstan-import-type RequestOptions from Types
 * @phpstan-import-type SignedAssetUrl from Types
 * @phpstan-import-type ViewerClaims from Types
 */
final class Cdn extends Resource
{
    protected const OPERATIONS = 'cdn';

    /** A signed URL's lifetime in seconds when `expiresIn` is omitted: 15 minutes, sent explicitly. */
    public const DEFAULT_SIGNED_URL_EXPIRES_IN = 900;
    /** The longest signed URL lifetime in seconds the API accepts: 24 hours. */
    public const MAX_SIGNED_URL_EXPIRES_IN = 86400;

    /** `getAssetInfo`'s `availability`: the viewer can see the content now. */
    public const AVAILABILITY_AVAILABLE = 'available';
    /** `getAssetInfo`'s `availability`: the content needs the viewer's age confirmed (`viewerClaims.ageConfirmed`). */
    public const AVAILABILITY_AGE_RESTRICTED = 'age-restricted';
    /** `getAssetInfo`'s `availability`: held, blocked in the viewer's region, not yet moderated or removed. */
    public const AVAILABILITY_UNAVAILABLE = 'unavailable';
    public const AVAILABILITIES = [self::AVAILABILITY_AVAILABLE, self::AVAILABILITY_AGE_RESTRICTED, self::AVAILABILITY_UNAVAILABLE];

    /**
     * Where each resource is served beneath an asset URL, in the order messages list them. The
     * adaptive stream is its HLS master playlist; its media playlists and segments are the other
     * files beneath `hls/`.
     */
    private const RESOURCE_PATHS = ['original' => 'original', 'rendered' => 'rendered', 'preview' => 'preview',
        'placeholder' => 'placeholder', 'hls' => 'hls/index.m3u8', 'embed' => 'embed', 'info' => 'info'];

    /** Every resource beneath an asset URL. */
    public const RESOURCES = ['original', 'rendered', 'preview', 'placeholder', 'hls', 'embed', 'info'];

    /**
     * The resources that take a lens or transform: the rendered file and the preview. The others
     * (the exact upload, the placeholder, the stream, the embed page and the info) take none.
     */
    public const SELECTABLE_RESOURCES = ['rendered', 'preview'];

    /** The asset segment that names an asset by its external ID starts with this. */
    private const EXTERNAL_ID_PREFIX = 'ext:';

    /** The ISO 3166-1 alpha-2 countries a viewer's region can be. EU is not a viewer country. */
    private const VIEWER_COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

    /**
     * Builds an asset's CDN URL without sending a request: the asset URL, which every resource is a
     * path beneath, or a resource URL when `resource` is given, with its lens or transform and the
     * viewer claims. Use it for public assets; private ones need `signAssetUrl`.
     *
     * Name the asset by exactly one of `assetId` and `externalId` (the external ID it was uploaded
     * with); `projectId` defaults to the client's project. `resource` is `rendered` (the
     * displayable file: an image in the best format the client accepts, a PDF, or browser-safe
     * video or audio), `original` (the exact upload), `preview` (a still image for the asset),
     * `placeholder` (a small blurred PNG; private or blocked assets require a signed URL or download permission), `hls` (the HLS master
     * playlist of audio or video, at `hls/index.m3u8`, once `content.hls.status` is `ready`), `embed` (an HTML
     * page that shows the asset, for an iframe) or `info` (the display info `getAssetInfo` reads).
     * Only `rendered` and `preview` take a `lens` or `transform`, applied in one pass, with transform
     * options replacing the lens's same-named options; the CDN refuses them on rendered PDFs, video
     * and audio with `transform/invalid`. Without a resource the URL takes neither.
     *
     * `viewerClaims` takes `region` (an ISO 3166-1 alpha-2 country, such as `DE`) and
     * `ageConfirmed`, and is added as the `viewerClaims` query, leaving out the defaults: a region
     * only when set, `ageConfirmed` only when true. They are assertions from your app; CalmLens
     * doesn't verify them. The CDN
     * requires `ageConfirmed` before it serves an age-restricted asset, even with a signed URL or an
     * API key.
     *
     * @param array{projectId?: string, assetId?: string, externalId?: string, resource?: string, lens?: string,
     *   transform?: string|array<string, mixed>, viewerClaims?: array{region?: string, ageConfirmed?: bool}} $options
     */
    public function getAssetUrl(array $options): string
    {
        Values::knownOptions($options, 'cdn.getAssetUrl');
        $options = Values::withoutNulls($options, 'cdn.getAssetUrl');
        $project = Values::segment($options['projectId'] ?? $this->session->projectId);
        return self::appendLocation($this->session->cdnBaseUrl . '/assets/' . $project . '/' . self::assetSegment($options), $options);
    }

    /**
     * Signs a private asset's URL on your server, so browsers and apps can load it without an API
     * key until it expires. Every resource is a path beneath it, as beneath a public asset URL;
     * `original` only when signed with `original: true`. With a `resource`, it returns that
     * resource's URL beneath the grant.
     *
     * Name the asset by exactly one of `assetId` and `externalId`; `projectId` defaults to the
     * client's project. `expiresIn` is the lifetime in whole seconds, from 1 to 86400
     * (`DEFAULT_SIGNED_URL_EXPIRES_IN`, 15 minutes, when omitted). `resource`, `lens`, `transform`
     * and `viewerClaims` aren't part of the grant: they are appended exactly as `getAssetUrl`
     * appends them, and can be changed later without signing again. The options are checked
     * before anything is sent.
     *
     * @param array{
     *     assetId?: string, externalId?: string, expiresIn?: int, original?: bool, projectId?: string,
     *     resource?: string, lens?: string, transform?: string|array<string, mixed>,
     *     viewerClaims?: ViewerClaims, requestOptions?: RequestOptions,
     * } $options
     * @return SignedAssetUrl the signed URL and its expiry in unix milliseconds
     */
    public function signAssetUrl(array $options): array
    {
        [$api, $request] = $this->split($options, __FUNCTION__);
        $expiresIn = $api['expiresIn'] ?? self::DEFAULT_SIGNED_URL_EXPIRES_IN;
        if (!is_int($expiresIn) || $expiresIn < 1 || $expiresIn > self::MAX_SIGNED_URL_EXPIRES_IN) {
            Values::invalid('expiresIn must be a whole number of seconds from 1 to ' . self::MAX_SIGNED_URL_EXPIRES_IN);
        }
        $original = $api['original'] ?? false;
        if (!is_bool($original)) {
            Values::invalid('original must be a boolean');
        }
        self::assetSegment($api);
        // The location is appended to the signed URL: check it before signing.
        self::appendLocation('', $api);
        $project = Values::segment($api['projectId'] ?? $this->session->projectId);
        $body = (array_key_exists('assetId', $api) ? ['assetId' => $api['assetId']] : ['externalId' => $api['externalId']])
            + ['expiresIn' => $expiresIn, 'original' => $original];
        $signed = $this->session->request('POST', '/projects/' . $project . '/signed-asset-urls', body: $body, options: $request);
        if (!is_string($signed['url'] ?? null) || $signed['url'] === '') {
            throw CalmLensException::create('sdk/invalid-response', 'The API returned no signed asset URL');
        }
        return ['url' => self::appendLocation($signed['url'], $api), 'expiresAt' => $signed['expiresAt'] ?? null];
    }

    /**
     * Fetches the display info of an asset URL, public or signed (`{url}/info`): the public asset
     * fields a viewer needs, with the same names as on an asset (`id`, `projectId`, `type`,
     * `externalUrl` and `content` with `format`, `width`, `height`, `durationSeconds`, `pageCount`,
     * `rendered`, `preview` and `hls`), and whether the viewer its claims describe can see it now
     * (`availability`, one of `AVAILABILITIES`). It never holds moderation results, metadata,
     * names, tags or extracted text.
     *
     * The claims are `viewerClaims`, else those the URL carries. It sends no API key, as a browser
     * would. A refusal throws the CDN's error, such as `signed-url/expired` or
     * `asset/not-available`.
     *
     * @param array{viewerClaims?: array{region?: string, ageConfirmed?: bool}, requestOptions?: array<string, mixed>} $options
     * @return array{id: string, projectId: string, type: string, externalUrl: ?string,
     *   content: array{format: ?string, width: ?int, height: ?int, durationSeconds: int|float|null, pageCount: ?int,
     *   rendered: ?array<string, mixed>, preview: ?array<string, mixed>, hls: ?array<string, mixed>}, availability: string}
     */
    public function getAssetInfo(string $url, array $options = []): array
    {
        Values::knownOptions($options, 'cdn.getAssetInfo');
        $request = $options['requestOptions'] ?? [];
        if (!is_array($request)) {
            Values::invalid('requestOptions must be an array');
        }
        $parts = parse_url($url);
        if (!is_array($parts) || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) || empty($parts['host'])) {
            Values::invalid('The URL must be an absolute asset URL');
        }
        [$base, $query] = explode('?', explode('#', $url, 2)[0], 2) + [1 => ''];
        $claims = $options['viewerClaims'] ?? null;
        if ($claims === null) {
            foreach (explode('&', $query) as $pair) {
                [$key, $value] = explode('=', $pair, 2) + [1 => ''];
                if (urldecode($key) === 'viewerClaims') {
                    try {
                        $claims = json_decode(urldecode($value), true, 512, JSON_THROW_ON_ERROR);
                    } catch (\JsonException) {
                        Values::invalid("The asset URL's viewerClaims are not JSON");
                    }
                }
            }
        }
        $info = $this->session->cdnJson(rtrim($base, '/') . '/info' . self::claimsQuery($claims), $request);
        if (!is_string($info['id'] ?? null) || !is_string($info['projectId'] ?? null) || !is_string($info['type'] ?? null)
            || !is_array($info['content'] ?? null) || !in_array($info['availability'] ?? null, self::AVAILABILITIES, true)) {
            throw CalmLensException::create('sdk/invalid-response', 'The CDN returned no asset info');
        }
        return $info;
    }

    /**
     * Fetches CDN content with the client's API key and returns a PSR-7 response with a streaming
     * body; HTTP errors are returned, not thrown. It takes `getAssetUrl`'s options, with `resource`
     * defaulting to `rendered`, and `init` with a `method` (GET or HEAD) and extra `headers`.
     */
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
        return $this->session->cdn($method, $this->getAssetUrl($api + ['resource' => 'rendered']), $init['headers'] ?? [], $request);
    }

    /**
     * The asset segment of an asset URL: the path-encoded asset ID, or `ext:` and the URL-encoded
     * external ID. Exactly one of them must be given.
     */
    private static function assetSegment(array $options): string
    {
        $byId = array_key_exists('assetId', $options);
        if ($byId === array_key_exists('externalId', $options)) {
            Values::invalid('Pass either assetId or externalId');
        }
        if ($byId) {
            return Values::segment($options['assetId']);
        }
        if (!is_string($options['externalId']) || $options['externalId'] === '') {
            Values::invalid('externalId must be a non-empty string');
        }
        return self::EXTERNAL_ID_PREFIX . Values::component($options['externalId']);
    }

    /**
     * Appends a resource, its `@lens` and transform selector, and the viewer claims to an asset URL
     * (public or signed). Without `resource` the URL stays the asset URL, which takes no selector.
     */
    private static function appendLocation(string $assetUrl, array $options): string
    {
        $selected = array_key_exists('lens', $options) || array_key_exists('transform', $options);
        $url = $assetUrl;
        $resource = $options['resource'] ?? null;
        if ($resource === null) {
            if ($selected) {
                Values::invalid('A lens or transform needs a resource, such as rendered');
            }
        } else {
            if (!is_string($resource) || !isset(self::RESOURCE_PATHS[$resource])) {
                Values::invalid('resource must be one of ' . implode(', ', self::RESOURCES));
            }
            if ($selected && !in_array($resource, self::SELECTABLE_RESOURCES, true)) {
                Values::invalid("The $resource resource takes no lens or transform");
            }
            $url .= '/' . self::RESOURCE_PATHS[$resource];
            // One path segment: the lens, then options that replace the lens's same-named options.
            $selector = [];
            if (array_key_exists('lens', $options)) {
                $selector[] = '@' . Values::segment($options['lens']);
            }
            if (array_key_exists('transform', $options) && ($transform = Transforms::path($options['transform'])) !== '') {
                $selector[] = $transform;
            }
            if ($selector !== []) {
                $url .= '/' . implode(',', $selector);
            }
        }
        return $url . self::claimsQuery($options['viewerClaims'] ?? null);
    }

    /**
     * The `?viewerClaims=` query of a URL with these claims, or an empty string for the defaults: no
     * region and no age confirmation are left out, so default URLs stay cacheable.
     */
    private static function claimsQuery(mixed $claims): string
    {
        if ($claims === null) {
            return '';
        }
        if (!is_array($claims) || ($claims !== [] && array_is_list($claims))
            || array_diff(array_map('strval', array_keys($claims)), ['region', 'ageConfirmed']) !== []) {
            Values::invalid('viewerClaims takes only region and ageConfirmed');
        }
        $region = $claims['region'] ?? null;
        if ($region !== null && (!is_string($region) || !in_array($region, explode(' ', self::VIEWER_COUNTRIES), true))) {
            Values::invalid('viewerClaims.region must be an ISO 3166-1 alpha-2 country code, such as DE');
        }
        $ageConfirmed = $claims['ageConfirmed'] ?? null;
        if ($ageConfirmed !== null && !is_bool($ageConfirmed)) {
            Values::invalid('viewerClaims.ageConfirmed must be a boolean');
        }
        $sent = ($region !== null ? ['region' => $region] : []) + ($ageConfirmed === true ? ['ageConfirmed' => true] : []);
        return $sent === [] ? '' : '?viewerClaims=' . rawurlencode(Values::json($sent));
    }
}
