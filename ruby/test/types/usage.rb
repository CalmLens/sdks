# frozen_string_literal: true

# Type-checked by Steep (see Steepfile), never run: calls every public method the way the README
# does, so a signature that rejects documented usage or loses a response field fails `steep check`.
require 'calmlens'
require 'calmlens/testing'
require 'logger'

client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', timeout: 30, max_retry_delay: 4,
                                    app_info: { name: 'my-app', version: '1.2.0', url: 'https://example.com' },
                                    logger: Logger.new($stdout), log_level: 'debug',
                                    on_request: ->(event) { [event[:operation], event[:status], event[:duration]] })
from_env = CalmLens::ServerClient.new

asset = client.text.classify(text: 'Hello', name: 'greeting', external_id: 'post-1',
                             processing_options: { retain_content: true })
decision = asset.classification.moderation.decision
request_id = asset.last_response&.request_id
processing = asset.classification.status
failure = asset.classification.failure_reason
reviews = asset.classification.moderation.manual_reviews.map do |review|
  [review.decision, review.decided_by.type, review.decided_by.id, review.applied]
end
automated = asset.classification.moderation.automated_status
regional = asset.classification.moderation.regions.map { |region| [region.region, region.status] }
removal = asset.content.removal_reason
format = asset.content.format
camera = asset.content.metadata&.camera_model
sexual = asset.classification.moderation.categories&.fetch('sexual', nil)
score = sexual&.score
faces = asset.classification.face_detection&.faces || []
ages = faces.map { |face| face.age_range&.low }
matched_decision = case asset
                   in { classification: { moderation: { decision: 'allowed' | 'limited' } } } then true
                   else false
                   end
raw = asset.to_h['classification']

uploaded = client.assets.create(name: 'photo.jpg', content: { type: 'image/jpeg', data: File.open('photo.jpg', 'rb') },
                                metadata: [{ id: 'author', value: { 'name' => 'Ada' } }], tags: %w[catalogue backpacks],
                                visibility: 'private',
                                processing_options: { features: { face_detection: { enabled: true, age_estimation: true },
                                                                  ocr: { enabled: true }, streaming: { enabled: true } } },
                                request_options: { idempotency_key: 'upload-1', timeout: 60, headers: { 'X-Trace' => '1' } })
first = client.assets.classify(name: 'big.png', part: { type: 'image/png', base64: 'AAAA', is_final: false },
                               total_size_in_bytes: 12_000_000)
client.assets.upload_part(first.id, part: { part_number: 2, data: 'bytes', is_final: true }, wait: false)
client.assets.classify(name: 'page', url: 'https://example.com')
reply = client.text.classify(text: 'Same to you', author_id: 'user-9',
                             context: { items: [{ text: 'Nice photo!', author_id: 'user-1' }, { text: 'Thanks' }] })
earlier = reply.context&.items&.map { |post| [post.text, post.author_id] }
author = reply.author_id
used = CalmLens::ModerationContext.select_items([{ text: 'Nice photo!' }]).map { |post| post['text'] }
limits = [CalmLens::ModerationContext::USED_ITEMS, CalmLens::ModerationContext::USED_CHARACTERS]

page = client.assets.list(page_size: 20, filter: 'classification.moderation.decision==allowed;folderId==null',
                          sort: '-createdAt,id')
names = page.map(&:name)
more = page.next_page? ? page.next_page.items.size : 0
client.assets.list(filter: 'classification.moderation.decision==blocked').auto_paging_each.map(&:id)
children = client.assets.list_children(uploaded.id, sort: 'createdAt').auto_paging_each.to_a
segments = client.assets.list_timeline(uploaded.id).auto_paging_each.map(&:start_seconds)
results = client.assets.search(query: 'cat', mode: 'semantic', page_size: 5)
matched = results.items.map { |result| [result.asset.id, result.score, result.matched_fields] }
updated = client.assets.update(uploaded.id, tags: %w[a b], description: nil)
client.assets.move(updated.id, folder_id: nil)
client.assets.retry(updated.id)
client.assets.explain(updated.id, rerun: true)
client.assets.decide(updated.id, decision: 'blocked', note: 'Spam')
client.assets.decide(updated.id, decision: 'purged', note: 'Illegal', confirm_purge: true)
client.assets.wait_for_decision(uploaded.id, timeout: 30).classification.moderation.decision
client.assets.remove_content(updated.id).content.updated_at
signed = client.cdn.sign_asset_url(asset_id: updated.id, expires_in: 600, resource: 'rendered',
                                   transform: { width: 200, fit: 'cover' })
expires = signed.expires_at
info = client.cdn.get_asset_info(signed.url, viewer_claims: { region: 'DE' })
available = info.availability == 'available' && info.content.rendered&.kind
client.assets.delete(updated.id)

folder = client.folders.create(name: 'Inbox', parent_id: nil)
client.folders.update(folder.id, name: 'Archive')
client.folders.move(folder.id, parent_id: nil)
folders = client.folders.list(sort: '-createdAt', page_size: 20)
folders.items.map(&:parent_id)
folders.ancestors.map(&:name)
client.folders.list(parent_id: folder.id, sort: 'name').auto_paging_each.map(&:name)
client.folders.retrieve(folder.id)
client.folders.delete(folder.id)

hash_list = client.hash_lists.create(name: 'Removed images', action: 'block', description: nil)
client.hash_lists.update(hash_list.id, action: 'flag', description: nil)
hash_lists = client.hash_lists.list(page_size: 20)
hash_lists.map(&:action)
client.hash_lists.list(sort: 'createdAt').auto_paging_each.map(&:name)
client.hash_lists.retrieve(hash_list.id)
entry = client.hash_lists.add_entry(hash_list.id, hash: '0' * 64, quality: 90, label: 'Report 1042')
client.hash_lists.add_entry(hash_list.id, asset_id: 'asset-1')
entries = client.hash_lists.list_entries(hash_list.id, page_size: 50)
entries.each_page { |entries_page| entries_page.map { |item| item[:hash] } }
client.hash_lists.remove_entry(entry.id)
client.hash_lists.delete(hash_list.id)

lenses = client.ensure_lenses(lenses: [{ identifier: 'thumb', name: 'Thumb', type: 'image', active: true,
                                         transform: { width: 128, format: 'webp' } }])
lens = client.ensure_lens(identifier: 'small', name: 'Small', type: 'image')
lens_width = lenses.first&.dig(:transform, 'width')
card = client.lenses.create(identifier: 'card', name: 'Card', type: 'image', active: true, description: nil,
                            transform: { width: 600 })
client.lenses.update(card.id, name: 'Wide card', transform: { width: 1200 })
client.lenses.retrieve(card.id).identifier
lens_page = client.lenses.list(page_size: 10, sort: '-createdAt')
lens_names = lens_page.map(&:name) if lens_page.next_page?
client.lenses.list.auto_paging_each.map(&:active)
client.lenses.delete(card.id)

policy = client.policies.retrieve_assigned
mode = policy.preset&.mode
policies = client.policies.list(page_size: 10, sort: 'createdAt')
policies.map(&:project_ids)
client.policies.list.auto_paging_each.map(&:name)
custom = client.policies.create(name: 'Strict', settings: policy.settings)
client.policies.update(custom.id, revision: custom.revision, name: 'Stricter')
kids = client.policies.create(preset_id: 'children-platform')
preset_version = kids.preset&.version || 1
client.policies.reset(kids.id, revision: kids.revision, preset_version: preset_version)
client.policies.upgrade(kids.id, revision: kids.revision, preset_version: preset_version)
client.policies.set_automatic_updates(policy.id, enabled: false, revision: policy.revision,
                                                 preset_version: policy.preset&.latest_version || 1)
client.policies.assign(policy_id: kids.id)
client.policies.delete(custom.id)
upload_presets = client.upload_presets.ensure(
  upload_presets: [{ key: 'avatars', name: 'Avatars', revision: 0, allowed_content_types: ['image/*'], folder_id: nil }]
)
avatars = upload_presets.upload_presets.first
client.upload_presets.list(page_size: 10, sort: '-createdAt').map(&:key)
client.upload_presets.list.auto_paging_each.map(&:revision)
client.upload_presets.delete(avatars&.id || 'preset-1')
project_settings = client.project_settings.get
client.project_settings.update(revision: project_settings.revision, settings: { block_unmoderated_assets: false, remote_url_rule: nil })
client.project_settings.update(settings: { ai_media_search_enabled: true }, search_indexing_budget_units: 120)
sampled_percent = project_settings.settings.human_review.allowed_sample_percent
fields = client.metadata_fields.ensure(fields: [{ id: 'userId', title: 'User', type: 'string', icon: 'user', color: '#2563eb' }])
client.metadata_fields.list.fields.map(&:id)
client.metadata_fields.delete('userId', revision: fields.revision)
token = client.upload_tokens.sign(upload_preset_id: 'preset-1', external_id: 'post-42', expires_in: 120).token

url = client.cdn.get_asset_url(asset_id: 'post-1', resource: 'preview', lens: lens.identifier, viewer_claims: { age_confirmed: true })
renditions = asset.content.hls&.renditions&.map { |rendition| [rendition.kind, rendition.bandwidth] }
embed = client.cdn.get_asset_url(external_id: 'post-1', project_id: 'project-2', resource: 'embed')
hls = client.cdn.sign_asset_url(external_id: 'post-1', original: true, resource: 'hls').url
bytes = client.cdn.serve(asset_id: 'post-1', init: { method: 'HEAD', headers: { 'If-None-Match' => 'x' } }) do |response|
  response.success? ? response.body(limit: 1024) : nil
end

feed = client.events.list
cursor = feed.next_cursor
feed.each_page.map(&:next_cursor)
client.events.list(cursor: cursor, types: %w[asset.blocked asset.purged], asset_id: 'asset-1').map { |item| item.actor.type }
batched = client.assets.batch(asset_ids: ['asset-1'], operation: 'delete').batch_id
client.events.list(cursor: cursor).auto_paging_each do |event|
  case event.type
  when 'asset.blocked', 'asset.purged'
    event.facts.select { |fact| fact.key == 'flagged-categories' }.map(&:value)
  end
end
custom_call = client.request('GET', '/projects/project/assets', query: { pageSize: 1 }, request_options: { max_retries: 0 })

begin
  client.assets.retrieve('missing')
rescue CalmLens::NotFoundError => e
  [e.code == CalmLens::ErrorCodes::ASSET_NOT_FOUND, e.status, e.request_id, e.details&.dig('issues'), e.body, e.url]
rescue CalmLens::UnprocessableEntityError, CalmLens::PayloadTooLargeError, CalmLens::CancelledError => e
  e.http_method
end

webhook = CalmLens.parse_webhook_event(payload: '{}', signature: 'v1=x', timestamp: '1', secret: 'whsec')
webhook_status = webhook.dig(:asset, :classification, :moderation, :decision)
webhook_test = webhook.test?
webhook_actor = webhook.actor.type
flagged = CalmLens.get_event_fact(webhook, 'flagged-categories')
webhook_facts = CalmLens.get_event_facts(webhook).keys
client.close

# @type var moderate: ^(CalmLens::MockModerationInput) -> (CalmLens::MockDecision::status | CalmLens::MockDecision)
moderate = lambda do |input|
  next 'pending' if input.queued? && input.trigger == 'upload'

  text = input.content.text
  text&.include?('threat') ? CalmLens::MockDecision.of('blocked').flag('violence', 0.9, 'violence-threat' => 0.9) : 'allowed'
end
mock = CalmLens::MockServerClient.new(moderate: moderate)
completed = mock.complete_processing('asset-1', CalmLens::MockDecision.of('age-restricted').not_evaluated('profanity'))
mock.complete_processing('asset-2')
mock.fail_next_request('upload/website-rate-limit-reached', operation: 'assets.create', details: { 'reason' => 'busy' }, retry_after: 30)
mock.enqueue_event(type: 'asset.allowed', asset_id: 'asset-1',
                   actor: { type: 'automated', id: nil }, facts: [{ key: 'asset-name', value: 'beach.jpg' }],
                   asset: { id: 'asset-1', upload: { status: 'completed' },
                            classification: { status: 'completed', moderation: { decision: 'allowed' } },
                            content: { status: 'removed' } })
mock.state.assets.each_value { |item| item['classification'] }
mock.enqueue(status: 503, body: { code: 'server/unavailable' }).requests.map(&:path)
answered = mock.clear_requests.requests.map(&:status)
fetched = mock.fetch_cdn(mock.cdn.sign_asset_url(asset_id: 'asset-1', resource: 'rendered').url).status

test_input_key = ENV.fetch('CALMLENS_TEST_INPUT_KEY')
mixed = CalmLens::TestInputs::PRESETS.fetch(:mixed)
signed_code = CalmLens::TestInputs.generate_text_code(mixed, test_input_key)
scored = CalmLens::TestInputs.generate_text_code({ instances: [{ category: 'violence', score: 0.9, qualifiers: ['violence-threat'] }] },
                                                 test_input_key)
phrase = CalmLens::TestInputs.generate_media_code('violence', test_input_key)
painted = CalmLens::TestInputs.paint_image('violence', test_input_key).png

[decision, request_id, processing, failure, reviews, removal, format, camera, score, ages, matched_decision, raw, names, more,
 children, matched, expires, available, lens_width, url, renditions, embed, hls, bytes, webhook_status, webhook_test, earlier,
 author, used, limits, completed, answered, fetched, signed_code, scored, phrase, painted, automated, regional, batched,
 webhook_actor, segments, lens_names, mode, token, flagged, webhook_facts, sampled_percent, custom_call, from_env]
