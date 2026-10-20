# frozen_string_literal: true

module CalmLens
  # Lens definitions, cached per client. Used through {ServerClient#ensure_lenses} and {ServerClient#ensure_lens}.
  # @api private
  class Lenses < Resource
    def ensure_lenses(options)
      call(options) { |api, request| @session.ensure_lenses(api['lenses'], request) }
    end

    def ensure_lens(options)
      call(options) { |api, request| @session.ensure_lenses([api], request).first }
    end
  end
  private_constant :Lenses
end
