package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * What {@code assets.batch} returns once the operation is queued. The {@code asset.deleted} and
 * {@code asset.content-removed} events the batch records carry a {@code batch-id} fact naming
 * {@code batchId}.
 */
public final class BatchAssetsResponse extends CalmLensObject {
  @Required private String batchId;
  @Required private BatchStatus status;
  @Required private Integer assetCount;

  private BatchAssetsResponse() {}

  /** @return the batch's ID ({@code batch_} prefix) */
  public String getBatchId() { return required(batchId, "batchId"); }

  /** @return {@code queued} */
  public BatchStatus getStatus() { return required(status, "status"); }

  /** @return how many distinct assets the batch covers */
  public int getAssetCount() { return required(assetCount, "assetCount"); }
}
