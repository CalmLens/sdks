# frozen_string_literal: true

require 'zlib'

module CalmLens
  module Testing
    # Renders a ThumbHash as the small PNG the CDN serves for an asset's `placeholder` resource,
    # byte for byte like the CDN's renderer: the ThumbHash decoded to RGBA, stored uncompressed.
    # @api private
    module Placeholder
      module_function

      # @param hash [String] the base64 ThumbHash
      # @return [String] PNG bytes
      def png(hash)
        width, height, rgba = rgba(hash.unpack1('m0').bytes)
        encode(width, height, rgba)
      end

      # Decodes ThumbHash bytes to its width, height and RGBA pixels (RGB not premultiplied).
      def rgba(hash)
        header = hash[0] | (hash[1] << 8) | (hash[2] << 16)
        alpha = (header >> 23) == 1
        landscape = ((hash[3] | (hash[4] << 8)) >> 15) == 1
        short = alpha ? 5 : 7
        lx = [3, landscape ? short : hash[3] & 7].max
        ly = [3, landscape ? hash[3] & 7 : short].max
        channels = channels(hash, header, alpha, lx, ly)
        ratio = aspect_ratio(hash)
        width = (ratio > 1 ? 32 : 32 * ratio).round
        height = (ratio > 1 ? 32 / ratio : 32).round
        pixels = []
        height.times do |y|
          width.times do |x|
            fx = Array.new([lx, alpha ? 5 : 3].max) { |cx| Math.cos(Math::PI / width * (x + 0.5) * cx) }
            fy = Array.new([ly, alpha ? 5 : 3].max) { |cy| Math.cos(Math::PI / height * (y + 0.5) * cy) }
            pixels.concat(pixel(channels, fx, fy, lx, ly, alpha))
          end
        end
        [width, height, pixels]
      end

      # The DC values and AC coefficients of the luminance, colour and alpha channels.
      def channels(hash, header, alpha, lum_cols, lum_rows)
        header16 = hash[3] | (hash[4] << 8)
        index = 0
        start = alpha ? 6 : 5
        decode = lambda do |cols, rows, scale|
          values = []
          each_term(cols, rows) do
            values << (((((hash[start + (index >> 1)] >> ((index & 1) << 2)) & 15) / 7.5) - 1) * scale)
            index += 1
          end
          values
        end
        { l_dc: (header & 63) / 63.0, p_dc: (((header >> 6) & 63) / 31.5) - 1, q_dc: (((header >> 12) & 63) / 31.5) - 1,
          a_dc: alpha ? (hash[5] & 15) / 15.0 : 1.0,
          l: decode.call(lum_cols, lum_rows, ((header >> 18) & 31) / 31.0), p: decode.call(3, 3, ((header16 >> 3) & 63) / 63.0 * 1.25),
          q: decode.call(3, 3, ((header16 >> 9) & 63) / 63.0 * 1.25), a: alpha ? decode.call(5, 5, (hash[5] >> 4) / 15.0) : [] }
      end

      # Yields the index of each AC coefficient of an `nx` by `ny` channel with its cosine indexes.
      def each_term(cols, rows)
        index = 0
        rows.times do |cy|
          cx = cy.zero? ? 1 : 0
          while cx * rows < cols * (rows - cy)
            yield index, cx, cy
            index += 1
            cx += 1
          end
        end
      end

      def pixel(channels, cos_x, cos_y, lum_cols, lum_rows, alpha)
        l = channels[:l_dc]
        each_term(lum_cols, lum_rows) { |j, cx, cy| l += channels[:l][j] * cos_x[cx] * cos_y[cy] * 2 }
        p = channels[:p_dc]
        q = channels[:q_dc]
        each_term(3, 3) do |j, cx, cy|
          f = cos_x[cx] * cos_y[cy] * 2
          p += channels[:p][j] * f
          q += channels[:q][j] * f
        end
        a = channels[:a_dc]
        each_term(5, 5) { |j, cx, cy| a += channels[:a][j] * cos_x[cx] * cos_y[cy] * 2 } if alpha
        b = l - (2 / 3.0 * p)
        r = ((3 * l) - b + q) / 2
        [r, r - q, b, a].map { |value| [0, 255 * [1, value].min].max.to_i }
      end

      def aspect_ratio(hash)
        short = hash[2].anybits?(128) ? 5 : 7
        sides = hash[4].anybits?(128) ? [short, hash[3] & 7] : [hash[3] & 7, short]
        sides[0].to_f / sides[1]
      end

      # An uncompressed PNG: one stored deflate block per scanline.
      def encode(width, height, rgba)
        row = (width * 4) + 1
        lines = Array.new(height) { |y| "\0".b + rgba[y * width * 4, width * 4].pack('C*') }
        data = "\x78\x01".b
        lines.each_with_index { |line, y| data << [y + 1 < height ? 0 : 1, row, row ^ 0xffff].pack('Cvv') << line }
        data << [Zlib.adler32(lines.join)].pack('N')
        chunk = ->(type, body) { [body.bytesize].pack('N') + type.b + body + [Zlib.crc32(type.b + body)].pack('N') }
        "\x89PNG\r\n\x1a\n".b + chunk.call('IHDR', [width, height, 8, 6, 0, 0, 0].pack('NNC5')) +
          chunk.call('IDAT', data) + chunk.call('IEND', ''.b)
      end
    end
  end
end
