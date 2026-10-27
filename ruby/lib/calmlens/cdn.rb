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
    #   takes a lens or transform. A placeholder is a small blurred PNG that the CDN serves for public assets
    #   whatever their moderation status; it also takes no age_confirmed.
    # @option options [String] :lens a lens identifier
    # @option options [String, Hash, Array<Hash>] :transform a selector such as `width=200,fit=cover`,
    #   or structured steps: `{type: 'imageTransform', options: {width: 200}}` or an Array of them
    # @option options [Boolean] :age_confirmed true appends `?ageConfirmed=true`, so a public asset whose
    #   moderation status is `age-restricted` is served from this URL. Without it such an asset needs a signed
    #   URL or the API key. Set it only where your app has already decided the viewer may see age-restricted content.
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
    # @option options [Boolean] :age_confirmed see {#get_asset_url}
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
      if resource == 'placeholder' && (transformed)
        raise Internal.invalid('A placeholder takes no lens, transform or ageConfirmed')
      end

      url = "#{@session.cdn_base_url}/assets/#{Internal.segment(@session.project_id)}/" \
            "#{Internal.segment(api['assetIdentifier'])}/#{resource}"
      url += "/@#{Internal.segment(api['lens'])}" if api['lens']
      transform = api['transform']
      url += "/#{Transforms.path(transform)}" unless transform.nil? || transform == ''

      claims = api['viewerClaims']
      if claims && (!claims.is_a?(Hash) || (claims.key?('ageConfirmed') && ![true, false].include?(claims['ageConfirmed'])))
        raise Internal.invalid('Invalid viewerClaims')
      end
      query = []
      query << "viewerClaims=#{URI.encode_www_form_component(JSON.generate(api['viewerClaims']))}" if api['viewerClaims']
      query.empty? ? url : "#{url}?#{query.join('&')}"
    end
  end
end
