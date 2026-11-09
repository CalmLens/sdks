# frozen_string_literal: true

module CalmLens
  # Asset URLs, signed asset URLs, asset info and authenticated content delivery. Reach it through
  # {ServerClient#cdn}.
  #
  # Every asset has one URL, `{cdn_base_url}/assets/{project_id}/{asset}`, where `{asset}` is the asset
  # ID or `ext:` and the URL-encoded external ID. Each resource is a path beneath it, such as
  # `/rendered` or `/preview/@thumbnail,width=320`. A signed asset URL ({#sign_asset_url}) replaces
  # `{asset}` with a grant, and the same resources are paths beneath it.
  class CDN < Resource
    # The prefix of this resource's operations in Internal::OPTION_KEYS.
    OPERATIONS = 'cdn'

    # Where each resource is served beneath an asset URL. The adaptive stream is its HLS master
    # playlist; its media playlists and segments are the other files beneath `hls/`.
    RESOURCE_PATHS = {
      'original' => 'original', 'rendered' => 'rendered', 'preview' => 'preview',
      'hls' => 'hls/index.m3u8', 'embed' => 'embed', 'placeholder' => 'placeholder', 'info' => 'info'
    }.freeze
    private_constant :RESOURCE_PATHS

    # Every CDN resource beneath an asset URL, as {#get_asset_url} and {#sign_asset_url} accept them.
    RESOURCES = RESOURCE_PATHS.keys.freeze

    # A signed asset URL's lifetime in seconds when `expires_in` is omitted: 15 minutes.
    DEFAULT_SIGNED_URL_EXPIRES_IN = 15 * 60
    # The longest signed asset URL lifetime the API accepts, in seconds: 24 hours.
    MAX_SIGNED_URL_EXPIRES_IN = 24 * 60 * 60

    # The start of the asset segment of a URL that names the asset by its external ID.
    EXTERNAL_ID_PREFIX = 'ext:'

    # The ISO 3166-1 alpha-2 countries a viewer's `region` can be. EU is not a viewer country.
    VIEWER_COUNTRIES = %w[
      AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY
      BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK
      FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR
      IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK
      ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM
      PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF
      TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
    ].freeze

    # Builds an asset's CDN URL without a request: the asset URL, which every resource is a path
    # beneath, or a resource URL when `resource` is given, with its lens or transform and the viewer
    # claims. Use it for public assets; private ones need {#sign_asset_url} (or the API key, through
    # {#serve}).
    # @option options [String] :asset_id the asset ID; give it or `external_id`, not both
    # @option options [String] :external_id the external ID the asset was uploaded with, written as
    #   `ext:` and the URL-encoded ID
    # @option options [String] :project_id the asset's project; the client's by default
    # @option options [String] :resource `rendered` (the displayable file: an image in the best format the
    #   client accepts, a PDF, or browser-safe video or audio), `original` (the exact upload), `preview` (a
    #   still image for the asset), `hls` (the HLS master playlist of audio or video, at `hls/index.m3u8`,
    #   once `content.hls` is set), `embed` (an HTML page that shows the asset, a viewer for its type, for an
    #   iframe), `placeholder` (a small blurred PNG that the CDN serves publicly for every asset whatever its
    #   visibility or moderation status, without age confirmation) or `info` (the asset's display info, as
    #   {#get_asset_info} reads it). Without it, the URL is the asset URL itself. Lenses and transforms
    #   apply to `preview`, and to `rendered` when it is an image; the CDN refuses them on rendered PDFs,
    #   video and audio with `transform/invalid`, and the SDK refuses them on the other resources and
    #   without a resource.
    # @option options [String] :lens a lens identifier
    # @option options [String, Hash] :transform options applied in one pass: a selector such as
    #   `width=200,fit=cover`, or structured options such as `{width: 200, fit: 'cover'}`. With a lens,
    #   they replace the lens's options of the same name
    # @option options [Hash] :viewer_claims `{region:, age_confirmed:}`, sent as a JSON `viewerClaims` query
    #   parameter, leaving out the defaults (no region, age not confirmed). `region` is an ISO 3166-1
    #   alpha-2 country. The CDN serves an asset whose moderation status is `age-restricted` only with
    #   `age_confirmed: true`, even with a signed URL or the API key. Set it only where your app has
    #   already decided the viewer may see age-restricted content. Your platform confirms the viewer's
    #   age; viewer claims are assertions from your app, and CalmLens doesn't verify them.
    # @return [String]
    def get_asset_url(options)
      call(options, __method__) { |api, _request| asset_url(api) }
    end

    # Signs a private asset's URL on your server, so browsers and apps can load it without an API key
    # until it expires. Every resource is a path beneath it, as beneath a public asset URL; `original`
    # only when signed with `original: true`. With `resource`, returns that resource's URL beneath the
    # grant; lenses, transforms and viewer claims are appended as {#get_asset_url} appends them and
    # aren't part of the signature.
    # @option options [String] :asset_id give it or `external_id`, not both
    # @option options [String] :external_id
    # @option options [String] :project_id the client's by default
    # @option options [Integer] :expires_in whole seconds from 1 to 86400; 900 by default
    # @option options [Boolean] :original whether the URL also serves the exact upload (`original`); false by default
    # @option options [String] :resource see {#get_asset_url}
    # @option options [String] :lens
    # @option options [String, Hash] :transform
    # @option options [Hash] :viewer_claims
    # @return [Hash] `{'url', 'expiresAt'}`, `expiresAt` in milliseconds since the Unix epoch
    def sign_asset_url(options)
      call(options, __method__) do |api, request|
        check_signing(api)
        project = Internal.segment(api.fetch('projectId', @session.project_id))
        body = api.slice('assetId', 'externalId')
        body['expiresIn'] = api.fetch('expiresIn', DEFAULT_SIGNED_URL_EXPIRES_IN)
        body['original'] = api.fetch('original', false)
        signed = request('POST', "/projects/#{project}/signed-asset-urls", body: body, request_options: request)
        unless signed.is_a?(Hash) && signed['url'].is_a?(String) && !signed['url'].empty? && signed['expiresAt'].is_a?(Integer)
          raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'The API returned no signed asset URL')
        end

        { 'url' => append_location(signed['url'], api), 'expiresAt' => signed['expiresAt'] }
      end
    end

    # Reads the display info of an asset URL, public or signed: `{url}/info`, with the asset's type,
    # size, rendered file, preview and stream, and whether the viewer its claims describe can see it
    # now (`availability`: `available`, `age-restricted` or `unavailable`). It sends no API key, as a
    # browser would, so a private asset's info needs a signed URL.
    # @param url [String] an asset URL from {#get_asset_url} or {#sign_asset_url}, without a resource
    # @param viewer_claims [Hash, nil] the viewer's claims, as for {#get_asset_url}; the URL's own
    #   `viewerClaims` when omitted
    # @return [Hash] the asset info
    # @raise [APIError] with the CDN's code, such as `signed-url/expired` or `asset/not-available`
    def get_asset_info(url, viewer_claims: nil)
      base, claims = split_asset_url(url)
      claims = Internal.normalize(viewer_claims) unless viewer_claims.nil?
      info = @session.cdn_json("#{base}/info#{viewer_claims_query(claims)}")
      return info if asset_info?(info)

      raise InvalidResponseError.new(SdkErrorCodes::INVALID_RESPONSE, 'The CDN returned no asset info')
    rescue TypeError, ArgumentError, JSON::GeneratorError, EncodingError, URI::Error => e
      raise InvalidArgumentError.new(SdkErrorCodes::INVALID_ARGUMENT, e.message), cause: e
    end

    # Fetches content from the CDN with the client's API key.
    #
    # With a block, yields a {Response} whose body streams: call {Response#each_chunk} to write
    # it somewhere without holding it in memory. The method returns the block's value. Without a
    # block, returns the {Response} with its body read into memory. Error statuses are returned,
    # not raised; check {Response#status}.
    #
    # @option options [String] :asset_id see {#get_asset_url}
    # @option options [String] :external_id
    # @option options [String] :project_id
    # @option options [String] :resource `rendered` by default
    # @option options [String] :lens
    # @option options [String, Hash] :transform
    # @option options [Hash] :viewer_claims see {#get_asset_url}
    # @option options [Hash] :init `{method: 'GET' | 'HEAD', headers: {...}}`
    # @yieldparam response [Response]
    # @return [Response, Object]
    # @example Save content to a file
    #   File.open('photo.jpg', 'wb') do |file|
    #     client.cdn.serve(asset_id: id) do |response|
    #       raise "CDN returned #{response.status}" unless response.success?
    #       response.each_chunk { |chunk| file.write(chunk) }
    #     end
    #   end
    def serve(options, &)
      method, url, headers, request = call(options, __method__) do |api, request_options|
        init = api.fetch('init', {})
        raise Internal.invalid('init must be a Hash') unless init.is_a?(Hash)

        verb = init.fetch('method', 'GET').to_s.upcase
        raise Internal.invalid('init.method must be GET or HEAD') unless %w[GET HEAD].include?(verb)

        [verb, asset_url({ 'resource' => 'rendered' }.merge(api)), Internal.headers(init.fetch('headers', {})), request_options]
      end
      @session.cdn(method, url, headers, request, &)
    end

    private

    def asset_url(api)
      project = Internal.segment(api.fetch('projectId', @session.project_id))
      append_location("#{@session.cdn_base_url}/assets/#{project}/#{asset_segment(api)}", api)
    end

    # The asset segment of a URL: the asset ID, or `ext:` and the URL-encoded external ID.
    def asset_segment(api)
      raise Internal.invalid('Pass either asset_id or external_id') if api.key?('assetId') == api.key?('externalId')
      return Internal.segment(api['assetId']) if api.key?('assetId')

      external = api['externalId']
      raise Internal.invalid('external_id must be a non-empty String') unless external.is_a?(String) && !external.empty?

      EXTERNAL_ID_PREFIX + Internal.component(external)
    end

    # Appends a resource, its `@lens` and transform selector, and the viewer claims to an asset URL
    # (public or signed). Without a resource the URL stays the asset URL, which takes no selector.
    def append_location(url, api)
      resource = api['resource']
      selected = !api['lens'].nil? || !api['transform'].nil?
      if resource.nil?
        raise Internal.invalid('A lens or transform needs a resource, such as rendered') if selected
      else
        raise Internal.invalid("resource must be one of #{RESOURCES.join(', ')}") unless RESOURCE_PATHS.key?(resource)
        if Internal::UNSELECTABLE_CDN_RESOURCES.include?(resource) && selected
          raise Internal.invalid("The #{resource} resource takes no lens or transform")
        end

        url = "#{url}/#{RESOURCE_PATHS.fetch(resource)}"
        transform = api['transform']
        selector = [("@#{Internal.segment(api['lens'])}" if api['lens']),
                    (Transforms.path(transform) unless transform.nil? || transform == '')].compact.join(',')
        url += "/#{selector}" unless selector.empty?
      end
      "#{url}#{viewer_claims_query(api['viewerClaims'])}"
    end

    # Checks sign_asset_url's own options as the API does, then the location, before anything is sent.
    def check_signing(api)
      expires = api.fetch('expiresIn', DEFAULT_SIGNED_URL_EXPIRES_IN)
      unless expires.is_a?(Integer) && expires.between?(1, MAX_SIGNED_URL_EXPIRES_IN)
        raise Internal.invalid("expires_in must be a whole number of seconds from 1 to #{MAX_SIGNED_URL_EXPIRES_IN}")
      end
      raise Internal.invalid('original must be true or false') unless [true, false].include?(api.fetch('original', false))

      asset_segment(api)
      append_location('', api)
    end

    # The `?viewerClaims=` query of a URL with these claims: the region, and `ageConfirmed` only when
    # true. The defaults are left out, so default URLs stay cacheable.
    def viewer_claims_query(claims)
      return '' if claims.nil?

      unless claims.is_a?(Hash) && (claims.keys - %w[region ageConfirmed]).empty? &&
             (!claims.key?('region') || VIEWER_COUNTRIES.include?(claims['region'])) &&
             (!claims.key?('ageConfirmed') || [true, false].include?(claims['ageConfirmed']))
        raise Internal.invalid('Invalid viewer_claims: region is an ISO 3166-1 alpha-2 country and age_confirmed a boolean')
      end

      sent = {}
      sent['region'] = claims['region'] if claims.key?('region')
      sent['ageConfirmed'] = true if claims['ageConfirmed'] == true
      sent.empty? ? '' : "?viewerClaims=#{URI.encode_www_form_component(JSON.generate(sent))}"
    end

    # An asset URL without its query, and the viewer claims it carried, if any.
    def split_asset_url(url)
      raise Internal.invalid('url must be an absolute asset URL') unless url.is_a?(String) && url.match?(%r{\Ahttps?://[^/?#]+/}i)

      path, query = url.split('#', 2).first.split('?', 2)
      raw = URI.decode_www_form(query.to_s).to_h['viewerClaims']
      claims = begin
        raw && JSON.parse(raw)
      rescue JSON::ParserError
        raise Internal.invalid("The asset URL's viewerClaims are not JSON")
      end
      [path.sub(%r{/+\z}, ''), claims]
    end

    def asset_info?(info)
      info.is_a?(Hash) && info['id'].is_a?(String) && info['projectId'].is_a?(String) && info['type'].is_a?(String) &&
        info['content'].is_a?(Hash) && %w[available age-restricted unavailable].include?(info['availability'])
    end
  end
end
