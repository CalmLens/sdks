# frozen_string_literal: true

# Type-checked by Steep (see Steepfile), never run: calls every public method the way the README
# does, so a signature that rejects documented usage or loses a response field fails `steep check`.
require 'calmlens'
require 'calmlens/testing'

client = CalmLens::ServerClient.new(api_key: 'key', project_id: 'project', timeout: 30)

asset = client.text.moderate(text: 'Hello', name: 'greeting', external_id: 'post-1',
                             processing_options: { flagged_content_policy: { action: 'hide' } })
status = asset['moderation']['status']
processing = asset['processing']['status']
action = asset['moderation']['action']
removal = asset['content']['removalReason']
format = asset['content']['format']
sexual = asset.dig('moderation', 'report', 'categories', 'sexual')
score = sexual && sexual['status'] == 'evaluated' ? sexual['score'] : nil
faces = asset.dig('moderation', 'report', 'features', 'faceDetection', 'faces') || []
ages = faces.map { |face| face['ageRange']&.fetch('low') }

uploaded = client.assets.create(name: 'photo.jpg', content: { type: 'image/jpeg', data: File.open('photo.jpg', 'rb') },
                                metadata: [{ id: 'author', value: { 'name' => 'Ada' } }], visibility: 'private',
                                processing_options: { features: { face_detection: { enabled: true, age_estimation: true },
                                                                  ocr: { enabled: true } } },
                                request_options: { idempotency_key: 'upload-1', timeout: 60 })
first = client.assets.moderate(name: 'big.png', part: { type: 'image/png', base64: 'AAAA', is_final: false },
                               total_size_in_bytes: 12_000_000)
client.assets.upload_part(asset_id: first['id'], part: { part_number: 2, data: 'bytes', is_final: true }, queue: true)
client.assets.moderate(name: 'page', url: 'https://example.com')

page = client.assets.list(page_size: 20, filter: 'moderation.status==approved', ordering: [{ field: 'createdAt', direction: 'DESC' }])
names = page['items'].map { |item| item['name'] }
more = page['hasMore']
client.assets.each(filter: 'moderation.status==rejected') { |item| item['id'] }
children = client.assets.each_child(asset_id: uploaded['id']).to_a
results = client.assets.search(query: 'cat', mode: 'semantic', limit: 5)
matched = results['items'].map { |result| [result['asset']['id'], result['score'], result['matchedFields']] }
updated = client.assets.update(asset_id: uploaded['id'], tags: %w[a b], description: nil)
client.assets.move(asset_id: updated['id'], folder_id: nil)
client.assets.retry(asset_id: updated['id'])
client.assets.wait_for_decision(asset_id: uploaded['id'], timeout: 30)['moderation']['status']
client.assets.delete_content(asset_id: updated['id'])['content']['updatedAt']
signed = client.assets.create_signed_url(asset_id: updated['id'],
                                         transform: { type: 'imageTransform', options: { width: 200, fit: 'cover' } })
expires = signed['expiresAt']
client.assets.delete(asset_id: updated['id'])

folder = client.folders.create(name: 'Inbox', parent_id: nil)
client.folders.update(folder_id: folder['id'], name: 'Archive')
client.folders.move(folder_id: folder['id'], parent_id: nil)
client.folders.list['folders'].map { |item| item['parentId'] }
client.folders.retrieve(folder_id: folder['id'])
client.folders.delete(folder_id: folder['id'])

lenses = client.ensure_lenses(lenses: [{ identifier: 'thumb', name: 'Thumb', type: 'image', active: true, version: 2,
                                         transforms: [{ type: 'imageTransform', options: { width: 128, format: 'webp' } }] }])
lens = client.ensure_lens(identifier: 'small', name: 'Small', type: 'image', active: true)
lens_width = lenses.first&.dig('transforms', 0, 'options', 'width')

url = client.cdn.get_asset_url(asset_identifier: 'post-1', lens: lens['identifier'])
bytes = client.cdn.serve(asset_identifier: 'post-1', init: { method: 'HEAD', headers: { 'If-None-Match' => 'x' } }) do |response|
  response.success? ? response.body(limit: 1024) : nil
end

cursor = client.events.list['cursor']
client.events.each_page(after: cursor, limit: 10) { |events_page| events_page['cursor'] }
client.events.each(after: cursor) do |event|
  case event['type']
  when 'asset.flagged'
    event['facts'].select { |fact| fact['key'] == 'flagged-categories' }.map { |fact| fact['value'] }
  end
end

begin
  client.assets.retrieve(asset_id: 'missing')
rescue CalmLens::NotFoundError => e
  [e.code == CalmLens::ErrorCodes::ASSET_NOT_FOUND, e.status, e.request_id, e.details['traceId']]
end

webhook = CalmLens.parse_webhook_event(payload: '{}', signature: 'v1=x', timestamp: '1', secret: 'whsec')
webhook_action = webhook.data['asset']&.dig('moderation', 'action')
webhook_test = webhook.test?
client.close

mock = CalmLens::MockServerClient.new(queued_outcome: 'failed',
                                      analyzed_outcome: ->(item) { item['name'] == 'bad' ? 'rejected' : 'approved' })
CalmLens::MockServerClient.new(analyzed_outcome: { 'moderation' => { 'status' => 'rejected', 'action' => 'hide' } })
mock.enqueue_event(type: 'asset.approved', asset_id: 'asset-1', facts: [{ key: 'asset-name', value: 'beach.jpg' }],
                   asset: { id: 'asset-1', processing: { status: 'done' }, moderation: { status: 'approved', action: nil },
                            content: { status: 'removed' } })
mock.state.assets.each_value { |item| item['moderation']['status'] }
mock.enqueue(status: 503, body: { code: 'server/unavailable' }).requests.map(&:path)

[status, processing, action, removal, format, score, ages, names, more, children, matched, expires, lens_width, url, bytes,
 webhook_action, webhook_test]
