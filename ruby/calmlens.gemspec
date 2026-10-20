# frozen_string_literal: true

require_relative 'lib/calmlens/version'

Gem::Specification.new do |spec|
  spec.name = 'calmlens'
  spec.version = CalmLens::VERSION
  spec.summary = 'Ruby SDK for CalmLens moderation, storage and CDN delivery'
  spec.description = 'Server-side client for the CalmLens API: moderation, uploads, events, webhooks and CDN delivery.'
  spec.authors = ['CalmLens']
  spec.homepage = 'https://calmlens.com/docs/sdk/ruby'
  spec.license = 'MIT'
  spec.required_ruby_version = '>= 3.1'
  spec.metadata = {
    'homepage_uri' => 'https://calmlens.com',
    'documentation_uri' => 'https://calmlens.com/docs/sdk/ruby',
    'source_code_uri' => 'https://github.com/CalmLens/sdks/tree/main/ruby',
    'changelog_uri' => 'https://calmlens.com/docs/changelog',
    'rubygems_mfa_required' => 'true'
  }
  # Standard library only: net/http, json, openssl, securerandom and uri.
  spec.files = Dir['lib/**/*.rb', 'sig/**/*.rbs', 'README.md', 'LICENSE']
end
