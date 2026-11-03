# frozen_string_literal: true

module CalmLens
  # CDN URLs and authenticated content delivery. Reach it through {ServerClient#cdn}.
  class CDN < Resource
    RESOURCES = %w[original rendered placeholder].freeze
    private_constant :RESOURCES

    # Builds the CDN URL of an asset's rendered, original or placeholder resource. Private assets need the API key
    # ({#serve}) or a signed URL ({Assets#create_signed_url}).
    # @option options [String] :asset_identifier the asset ID or external ID
    # @option options [String] :resource `rendered` (default), `original` or `placeholder`. Only `rendered`
    #   takes a lens or transform. A placeholder is a small blurred PNG that the CDN serves publicly for every
    #   asset whatever its visibility or moderation status; it needs no age confirmation.
    # @option options [String] :lens a lens identifier
    # @option options [String, Hash] :transform options applied in one pass: a selector such as
    #   `width=200,fit=cover`, or structured options such as `{width: 200, fit: 'cover'}`. With a lens,
    #   they replace the lens's options of the same name
    # @option options [Hash] :viewer_claims viewer assertions, such as `{age_confirmed: true}`, sent as a JSON
    #   `viewerClaims` query parameter. The CDN serves an asset whose moderation status is `age-restricted` only
    #   with `age_confirmed: true`, even with a signed URL or the API key. Set it only where your app has already
    #   decided the viewer may see age-restricted content. Your platform confirms the viewer's age; CalmLens does
    #   not verify this claim, and anyone can add it to a public URL. To control who loads an age-restricted
    #   asset, make it private and include the claim in a signed URL.
    # @return [String]
    def get_asset_url(options)
      call(options) { |api, _request| url(api) }
    end

    # Fetches content from the CDN with the client's API key.
    #
    # With a block, yields a {Response} whose body streams: call {Response#each_chunk} to write
    # it somewhere without holding it in memory. The method returns the block's value. Without a
    # block, returns the {Response} with its body read into memory. Error statuses are returned,
    # not raised; check {Response#status}.
    #
    # @option options [String] :asset_identifier
    # @option options [Hash] :viewer_claims see {#get_asset_url}
    # @option options [Hash] :init `{method: 'GET' | 'HEAD', headers: {...}}`
    # @yieldparam response [Response]
    # @return [Response, Object]
    # @example Save content to a file
    #   File.open('photo.jpg', 'wb') do |file|
    #     client.cdn.serve(asset_identifier: id) do |response|
    #       raise "CDN returned #{response.status}" unless response.success?
    #       response.each_chunk { |chunk| file.write(chunk) }
    #     end
    #   end
    def serve(options, &)
      method, url, headers, request = call(options) do |api, request_options|
        init = api.fetch('init', {})
        raise Internal.invalid('init must be a Hash') unless init.is_a?(Hash)

        verb = init.fetch('method', 'GET').to_s.upcase
        raise Internal.invalid('init.method must be GET or HEAD') unless %w[GET HEAD].include?(verb)

        [verb, url(api), Internal.headers(init.fetch('headers', {})), request_options]
      end
      @session.cdn(method, url, headers, request, &)
    end

    private

    def url(api)
      resource = api.fetch('resource', 'rendered')
      raise Internal.invalid('Resource must be original, rendered or placeholder') unless RESOURCES.include?(resource)

      transformed = !api['lens'].nil? || !api['transform'].nil?
      raise Internal.invalid('Lenses and transforms apply only to the rendered resource') if resource == 'original' && transformed
      raise Internal.invalid('A placeholder takes no lens or transform') if resource == 'placeholder' && transformed

      url = "#{@session.cdn_base_url}/assets/#{Internal.segment(@session.project_id)}/" \
            "#{Internal.segment(api['assetIdentifier'])}/#{resource}"
      transform = api['transform']
      selector = [("@#{Internal.segment(api['lens'])}" if api['lens']),
                  (Transforms.path(transform) unless transform.nil? || transform == '')].compact.join(',')
      url += "/#{selector}" unless selector.empty?

      claims = api['viewerClaims']
      if !claims.nil? && (!claims.is_a?(Hash) || (claims.key?('ageConfirmed') && ![true, false].include?(claims['ageConfirmed'])))
        raise Internal.invalid('Invalid viewerClaims')
      end

      query = []
      query << "viewerClaims=#{URI.encode_www_form_component(JSON.generate(ordered_claims(claims)))}" if claims
      query.empty? ? url : "#{url}?#{query.join('&')}"
    end

    # Viewer claims in the order the other SDKs send them, so equal claims build equal CDN URLs.
    def ordered_claims(claims)
      known = %w[region ageConfirmed].select { |key| claims.key?(key) }.to_h { |key| [key, claims[key]] }
      known.merge(claims.except(*known.keys))
    end
  end
end
