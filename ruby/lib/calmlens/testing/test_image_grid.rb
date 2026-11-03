# frozen_string_literal: true

require 'zlib'

module CalmLens
  # The image grid behind the signed test images (test_inputs.rb).
  module TestInputs
    # The test image grid of packages/shared/src/TestImageGrid.ts, painted byte for byte: an odd
    # N×N grid with an alternating black-and-white ring, two Gray-coded bits per interior cell as
    # one of four luma levels (colour in chroma only), and Reed–Solomon parity over GF(256).
    # @api private
    module Grid
      # Target luma of the four data levels.
      LEVELS = [72, 128, 184, 240].freeze
      SYMBOL_LEVEL = [0, 1, 3, 2].freeze
      PARITY = 32
      # Category colours, carried in the chroma only.
      COLORS = {
        'sexual' => [232, 80, 160], 'violence' => [224, 56, 64], 'self-harm' => [24, 168, 152],
        'harassment' => [240, 128, 48], 'hate' => [144, 80, 216], 'criminal-activity' => [224, 184, 40],
        'personal-information' => [48, 128, 224], 'profanity' => [136, 192, 48]
      }.freeze
      NEUTRAL = [144, 152, 160].freeze

      # GF(256) with the polynomial 0x11d and generator 2.
      EXP = Array.new(512, 0)
      LOG = Array.new(256, 0)
      x = 1
      255.times do |i|
        EXP[i] = x
        LOG[x] = i
        x <<= 1
        x ^= 0x11d if x.anybits?(256)
      end
      (255...512).each { |i| EXP[i] = EXP[i - 255] }
      [EXP, LOG].each(&:freeze)

      module_function

      def mul(left, right) = left.zero? || right.zero? ? 0 : EXP[LOG[left] + LOG[right]]

      # g(x) = (x - a^0)...(x - a^31), highest coefficient first.
      GENERATOR = PARITY.times.reduce([1]) do |g, i|
        following = Array.new(g.size + 1, 0)
        g.each_with_index do |coefficient, j|
          following[j] ^= coefficient
          following[j + 1] ^= mul(coefficient, EXP[i])
        end
        following
      end.freeze

      def parity(block)
        parity = Array.new(PARITY, 0)
        block.each do |byte|
          factor = byte ^ parity[0]
          parity = parity.drop(1) << 0
          PARITY.times { |j| parity[j] ^= mul(GENERATOR[j + 1], factor) } unless factor.zero?
        end
        parity
      end

      # The codeword bytes a grid of `cells` holds, its block lengths and its data bytes.
      def layout(cells)
        capacity = (cells - 2) * (cells - 2) / 4
        blocks = (capacity + 254) / 255
        lengths = Array.new(blocks) { |index| (capacity / blocks) + (index < capacity % blocks ? 1 : 0) }
        [capacity, lengths, capacity - (blocks * PARITY)]
      end

      # The colour's chroma on the level's luma, scaled by the largest s/16 that keeps every
      # channel in 0-255. Each scaled difference is truncated toward zero (not floored).
      def pixel(colour, level)
        target = LEVELS[level]
        own = ((77 * colour[0]) + (150 * colour[1]) + (29 * colour[2])) >> 8
        16.downto(0) do |scale|
          pixel = colour.map do |channel|
            difference = channel - own
            magnitude = (difference.abs * scale) >> 4
            difference.negative? ? target - magnitude : target + magnitude
          end
          return pixel if pixel.all? { |channel| channel.between?(0, 255) }
        end
      end

      # The data cell's colour: the palette blended between opposite corners, in integers.
      def blend(palette, column, row, cells)
        span = cells - 1
        denominator = span * span
        position = ((column * (span - row)) + ((span - column) * row)) * (palette.size - 1)
        start = position / denominator
        remainder = position - (start * denominator)
        finish = palette[[start + 1, palette.size - 1].min]
        palette[start].each_with_index.map do |channel, c|
          ((channel * (denominator - remainder)) + (finish[c] * remainder)) / denominator
        end
      end

      # Paints `data` (a binary String) as a grid of the categories' colours: [width, RGBA String].
      def paint(data, categories)
        cells = (15..127).step(2).find { |size| layout(size)[2] >= data.bytesize }
        raise Internal.invalid('Test scenario is too large for a test image') unless cells

        stream = codeword_stream(data, cells)
        palette = categories.uniq.map { |category| COLORS.fetch(category) }
        palette = [NEUTRAL] if palette.empty?
        pixels = Array.new(cells * cells) { |cell| [*cell_pixel(stream, palette, cell, cells), 255].pack('C4') }
        cell_size = 2 * (512 / 2 / cells)
        rows = Array.new(cells) { |row| pixels[row * cells, cells].map { |pixel| pixel * cell_size }.join * cell_size }
        [cells * cell_size, rows.join.b]
      end

      # The padded data with each block's parity, the blocks interleaved byte by byte and whitened, so
      # a uniform area never reads as the all-zero codeword.
      def codeword_stream(data, cells)
        _, lengths, data_bytes = layout(cells)
        padded = data.bytes + Array.new(data_bytes - data.bytesize) { |i| i.odd? ? 0x11 : 0xec }
        offset = 0
        codewords = lengths.map do |length|
          block = padded[offset, length - PARITY]
          offset += block.size
          block + parity(block)
        end
        stream = Array.new(lengths.max) { |i| codewords.filter_map { |codeword| codeword[i] } }.flatten
        stream.each_with_index.map { |byte, i| byte ^ (((i * 151) + 77) & 255) }
      end

      # A cell's RGB: the ring alternates black and white; data cells hold two bits each.
      def cell_pixel(stream, palette, cell, cells)
        row, column = cell.divmod(cells)
        return [(row + column).odd? ? 255 : 0] * 3 if [row, column].any? { |at| at.zero? || at == cells - 1 }

        symbol = ((row - 1) * (cells - 2)) + column - 1
        index = symbol >> 2
        level = index < stream.size ? SYMBOL_LEVEL[(stream[index] >> (6 - (2 * (symbol & 3)))) & 3] : 0
        pixel(blend(palette, column, row, cells), level)
      end
    end

    # The PNG encoding of test images.
    # @api private
    module Png
      module_function

      # 8-bit RGBA rows without filtering in stored deflate blocks, so every SDK writes the same bytes.
      def png(width, height, rgba)
        stride = width * 4
        raw = Array.new(height) { |row| "\0".b + rgba.byteslice(row * stride, stride) }.join
        zlib = "\x78\x01".b
        blocks = (0...raw.bytesize).step(65_535).map { |offset| raw.byteslice(offset, 65_535) }
        blocks.each_with_index do |block, index|
          zlib << [index == blocks.size - 1 ? 1 : 0, block.bytesize, block.bytesize ^ 0xffff].pack('Cvv') << block
        end
        zlib << [Zlib.adler32(raw)].pack('N')
        chunk = ->(type, body) { [body.bytesize].pack('N') + type.b + body + [Zlib.crc32(type.b + body)].pack('N') }
        "\x89PNG\r\n\x1a\n".b + chunk.call('IHDR', [width, height, 8, 6, 0, 0, 0].pack('NNC5')) +
          chunk.call('IDAT', zlib) + chunk.call('IEND', ''.b)
      end
    end
    private_constant :Grid, :Png
  end
end
