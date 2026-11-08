# frozen_string_literal: true

# Type-checked by Steep (see Steepfile), never run: calls every public method the way the README
# does, so a signature that rejects documented usage or loses a response field fails `steep check`.
require 'calmlens'
require 'calmlens/testing'

client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', timeout: 30)

asset = client.text.classify(text: 'Hello', name: 'greeting', external_id: 'post-1',
                             processing_options: { keep_content_after_processing: true })
status = asset['classification']['moderation']['status']
processing = asset['classification']['status']
failure = asset['classification']['failureReason']
reviews = asset['classification']['moderation']['manualReviews'].map do |review|
  [review['decision'], review['decidedBy']['type'], review['decidedBy']['id'], review['applied']]
end
automated = asset['classification']['moderation']['automatedStatus']
regional = asset['classification']['moderation']['regions'].map { |decision| [decision['region'], decision['status']] }
flagged_links = asset.dig('classification', 'moderation', 'linkSafety', 'links')&.map { |link| link['finalUrl'] }
removal = asset['content']['removalReason']
format = asset['content']['format']
camera = asset['content']['metadata']&.[]('cameraModel')
sexual = asset.dig('moderation', 'report', 'categories', 'sexual')
score = sexual && sexual['status'] == 'evaluated' ? sexual['score'] : nil
faces = asset.dig('classification', 'faceDetection', 'faces') || []
ages = faces.map { |face| face['ageRange']&.fetch('low') }

uploaded = client.assets.create(name: 'photo.jpg', content: { type: 'image/jpeg', data: File.open('photo.jpg', 'rb') },
                                metadata: [{ id: 'author', value: { 'name' => 'Ada' } }], tags: %w[catalogue backpacks],
                                visibility: 'private',
                                processing_options: { features: { face_detection: { enabled: true, age_estimation: true },
                                                                  ocr: { enabled: true }, streaming: { enabled: true } } },
                                request_options: { idempotency_key: 'upload-1', timeout: 60 })
first = client.assets.classify(name: 'big.png', part: { type: 'image/png', base64: 'AAAA', is_final: false },
                               total_size_in_bytes: 12_000_000)
client.assets.upload_part(asset_id: first['id'], part: { part_number: 2, data: 'bytes', is_final: true }, wait: false)
client.assets.classify(name: 'page', url: 'https://example.com')
reply = client.text.classify(text: 'Same to you', author_id: 'user-9',
                             context: { items: [{ text: 'Nice photo!', author_id: 'user-1' }, { text: 'Thanks' }] })
earlier = reply['context']&.fetch('items')&.map { |post| [post['text'], post['authorId']] }
author = reply['authorId']
used = CalmLens::ModerationContext.select_items([{ text: 'Nice photo!' }]).map { |post| post['text'] }
limits = [CalmLens::ModerationContext::USED_ITEMS, CalmLens::ModerationContext::USED_CHARACTERS]

page = client.assets.list(page_size: 20, filter: 'classification.moderation.status==allowed;folderId==null',
                          sort: '-createdAt,id')
names = page['items'].map { |item| item['name'] }
more = page['hasMore']
client.assets.each(filter: 'classification.moderation.status==blocked') { |item| item['id'] }
children = client.assets.each_child(asset_id: uploaded['id'], sort: 'createdAt').to_a
segments = client.assets.each_timeline_segment(asset_id: uploaded['id']).map { |segment| segment['startSeconds'] }
results = client.assets.search(query: 'cat', mode: 'semantic', page_size: 5)
matched = results['items'].map { |result| [result['asset']['id'], result['score'], result['matchedFields']] }
updated = client.assets.update(asset_id: uploaded['id'], tags: %w[a b], description: nil)
client.assets.move(asset_id: updated['id'], folder_id: nil)
client.assets.retry(asset_id: updated['id'])
client.assets.explain(asset_id: updated['id'], rerun: true)
client.assets.decide(asset_id: updated['id'], decision: 'blocked', note: 'Spam')
client.assets.decide(asset_id: updated['id'], decision: 'purged', note: 'Illegal', confirm_purge: true)
client.assets.wait_for_decision(asset_id: uploaded['id'], timeout: 30)['classification']['moderation']['status']
client.assets.remove_content(asset_id: updated['id'])['content']['updatedAt']
signed = client.cdn.sign_asset_url(asset_id: updated['id'], expires_in: 600, resource: 'rendered',
                                   transform: { width: 200, fit: 'cover' })
expires = signed['expiresAt']
info = client.cdn.get_asset_info(signed['url'], viewer_claims: { region: 'DE' })
available = info['availability'] == 'available' && info['content']['rendered']&.fetch('kind')
client.assets.delete(asset_id: updated['id'])

folder = client.folders.create(name: 'Inbox', parent_id: nil)
client.folders.update(folder_id: folder['id'], name: 'Archive')
client.folders.move(folder_id: folder['id'], parent_id: nil)
folders = client.folders.list(sort: '-createdAt', page_size: 20)
folders['items'].map { |item| item['parentId'] }
folders['ancestors'].map { |item| item['name'] }
client.folders.each(parent_id: folder['id'], sort: 'name') { |item| item['name'] }
client.folders.list(cursor: folders['nextCursor']) if folders['nextCursor']
client.folders.retrieve(folder_id: folder['id'])
client.folders.delete(folder_id: folder['id'])

hash_list = client.hash_lists.create(name: 'Removed images', action: 'block', description: nil)
client.hash_lists.update(hash_list_id: hash_list['id'], action: 'flag', description: nil)
hash_lists = client.hash_lists.list(page_size: 20)
hash_lists['items'].map { |item| item['action'] }
client.hash_lists.each(sort: 'createdAt') { |item| item['name'] }
client.hash_lists.list(cursor: hash_lists['nextCursor']) if hash_lists['nextCursor']
client.hash_lists.retrieve(hash_list_id: hash_list['id'])
entry = client.hash_lists.add_entry(hash_list_id: hash_list['id'], hash: '0' * 64, quality: 90, label: 'Report 1042')
client.hash_lists.add_entry(hash_list_id: hash_list['id'], asset_id: 'asset-1')
entries = client.hash_lists.list_entries(hash_list_id: hash_list['id'], page_size: 50)
client.hash_lists.list_entries(hash_list_id: hash_list['id'], cursor: entries['nextCursor']) if entries['nextCursor']
client.hash_lists.each_entry(hash_list_id: hash_list['id']) { |item| item['hash'] }
client.hash_lists.remove_entry(entry_id: entry['id'])
client.hash_lists.delete(hash_list_id: hash_list['id'])

lenses = client.ensure_lenses(lenses: [{ identifier: 'thumb', name: 'Thumb', type: 'image', active: true,
                                         transform: { width: 128, format: 'webp' } }])
lens = client.ensure_lens(identifier: 'small', name: 'Small', type: 'image', active: true)
lens_width = lenses.first&.dig('transform', 'width')
card = client.lenses.create(identifier: 'card', name: 'Card', type: 'image', active: true, description: nil,
                            transform: { width: 600 })
client.lenses.update(lens_id: card['id'], name: 'Wide card', transform: { width: 1200 })
client.lenses.retrieve(lens_id: card['id'])['identifier']
lens_page = client.lenses.list(page_size: 10, sort: '-createdAt')
lens_names = lens_page['items'].map { |item| item['name'] } if lens_page['hasMore']
client.lenses.each { |item| item['active'] }
client.lenses.delete(lens_id: card['id'])

policy = client.policies.retrieve_assigned
mode = policy['preset']&.fetch('mode')
policies = client.policies.list(page_size: 10, sort: 'createdAt')
policies['items'].map { |item| item['projectIds'] }
client.policies.each { |item| item['name'] }
custom = client.policies.create(name: 'Strict', settings: policy['settings'])
client.policies.update(policy_id: custom['id'], revision: custom['revision'], name: 'Stricter')
kids = client.policies.create(preset_id: 'children-platform')
preset_version = kids['preset']&.fetch('version') || 1
client.policies.reset(policy_id: kids['id'], revision: kids['revision'], preset_version: preset_version)
client.policies.upgrade(policy_id: kids['id'], revision: kids['revision'], preset_version: preset_version)
client.policies.set_automatic_updates(policy_id: policy['id'], enabled: false, revision: policy['revision'],
                                      preset_version: policy['preset']&.fetch('latestVersion') || 1)
client.policies.assign(policy_id: kids['id'])
client.policies.delete(policy_id: custom['id'])
upload_presets = client.upload_presets.ensure(
  upload_presets: [{ key: 'avatars', name: 'Avatars', revision: 0, allowed_content_types: ['image/*'], folder_id: nil }]
)
avatars = upload_presets['uploadPresets'].first
client.upload_presets.list(page_size: 10, sort: '-createdAt')['items'].map { |item| item['key'] }
client.upload_presets.each { |item| item['revision'] }
client.upload_presets.delete(upload_preset_id: avatars&.fetch('id') || 'preset-1')
project_settings = client.project_settings.get
client.project_settings.update(revision: project_settings['revision'], settings: { block_unmoderated_assets: false, remote_url_rule: nil })
client.project_settings.update(settings: { ai_media_search_enabled: true }, search_indexing_budget_units: 120)
sampled_percent = project_settings['settings']['humanReview']['allowedSamplePercent']
fields = client.metadata_fields.ensure(fields: [{ id: 'userId', title: 'User', type: 'string', icon: 'user', color: '#2563eb' }])
client.metadata_fields.list['fields'].map { |field| field['id'] }
client.metadata_fields.delete(field_id: 'userId', revision: fields['revision'])
token = client.upload_tokens.sign(upload_preset_id: 'preset-1', external_id: 'post-42', expires_in: 120)['token']

url = client.cdn.get_asset_url(asset_id: 'post-1', resource: 'preview', lens: lens['identifier'], viewer_claims: { age_confirmed: true })
renditions = asset['content']['hls']&.fetch('renditions')&.map { |rendition| [rendition['kind'], rendition['bandwidth']] }
embed = client.cdn.get_asset_url(external_id: 'post-1', project_id: 'project-2', resource: 'embed')
hls = client.cdn.sign_asset_url(external_id: 'post-1', original: true, resource: 'hls')['url']
bytes = client.cdn.serve(asset_id: 'post-1', init: { method: 'HEAD', headers: { 'If-None-Match' => 'x' } }) do |response|
  response.success? ? response.body(limit: 1024) : nil
end

cursor = client.events.list['nextCursor']
client.events.each_page(cursor: cursor, page_size: 10) { |events_page| events_page['nextCursor'] }
client.events.list(cursor: cursor, types: %w[asset.blocked asset.purged], asset_id: 'asset-1')['items'].map { |item| item['actor']['type'] }
batched = client.assets.batch(asset_ids: ['asset-1'], operation: 'delete')['batchId']
client.events.each(cursor: cursor) do |event|
  case event['type']
  when 'asset.blocked', 'asset.purged'
    event['facts'].select { |fact| fact['key'] == 'flagged-categories' }.map { |fact| fact['value'] }
  end
end

begin
  client.assets.retrieve(asset_id: 'missing')
rescue CalmLens::NotFoundError => e
  [e.code == CalmLens::ErrorCodes::ASSET_NOT_FOUND, e.status, e.request_id, e.details&.dig('issues')]
end

webhook = CalmLens.parse_webhook_event(payload: '{}', signature: 'v1=x', timestamp: '1', secret: 'whsec')
webhook_status = webhook.asset&.dig('classification', 'moderation', 'status')
webhook_test = webhook.test?
webhook_actor = webhook.actor&.fetch('type')
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
                            classification: { status: 'completed', moderation: { status: 'allowed' } },
                            content: { status: 'removed' } })
mock.state.assets.each_value { |item| item['classification']['moderation']['status'] }
mock.enqueue(status: 503, body: { code: 'server/unavailable' }).requests.map(&:path)
answered = mock.clear_requests.requests.map(&:status)
fetched = mock.fetch_cdn(mock.cdn.sign_asset_url(asset_id: 'asset-1', resource: 'rendered')['url']).status

test_input_key = ENV.fetch('CALMLENS_TEST_INPUT_KEY')
mixed = CalmLens::TestInputs::PRESETS.fetch(:mixed)
signed = CalmLens::TestInputs.generate_text_code(mixed, test_input_key)
scored = CalmLens::TestInputs.generate_text_code({ instances: [{ category: 'violence', score: 0.9, qualifiers: ['violence-threat'] }] },
                                                 test_input_key)
phrase = CalmLens::TestInputs.generate_media_code('violence', test_input_key)
painted = CalmLens::TestInputs.paint_image('violence', test_input_key).png

[status, processing, failure, reviews, removal, format, camera, score, ages, names, more, children, matched, expires, available,
 lens_width, url,
 renditions, embed, hls, bytes, webhook_status, webhook_test, earlier, author, used, limits, completed, answered, fetched, signed, scored,
 phrase, painted, automated, regional, flagged_links, batched, webhook_actor, segments, lens_names, mode, token, flagged, webhook_facts]
