package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;

/**
 * A project's metadata fields and their revision.
 */
public final class MetadataFieldsResource extends CalmLensObject {
  @Required private String projectId;
  @Required private Integer revision;
  @Required private List<MetadataField> fields;

  private MetadataFieldsResource() {}

  /** @return the project */
  public String getProjectId() { return required(projectId, "projectId"); }

  /** @return shared with the project's settings */
  public int getRevision() { return required(revision, "revision"); }

  /** @return the field definitions */
  public List<MetadataField> getFields() { return required(fields, "fields"); }
}
