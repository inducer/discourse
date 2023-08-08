import NavigationDefaultController from "discourse/controllers/navigation/default";
import { calculateFilterMode } from "discourse/lib/filter-mode";
import { dependentKeyCompat } from "@ember/object/compat";
import { tracked } from "@glimmer/tracking";
import { inject as service } from "@ember/service";
import { action } from "@ember/object";

export default class NavigationCategoryController extends NavigationDefaultController {
  @service composer;

  @tracked category;
  @tracked filterType;
  @tracked noSubcategories;

  @dependentKeyCompat
  get filterMode() {
    return calculateFilterMode({
      category: this.category,
      filterType: this.filterType,
      noSubcategories: this.noSubcategories,
    });
  }

  get createTopicTargetCategory() {
    if (this.category.canCreateTopic) {
      return this.category;
    }

    if (
      this.siteSettings.default_subcategory_on_read_only_category &&
      this.category.canCreateTopicSubcategory
    ) {
      return this.category.canCreateTopicSubcategory;
    }
  }

  get enableCreateTopicButton() {
    return !!this.createTopicTargetCategory;
  }

  @action
  handleCreateTopic() {
    if (this.currentUser?.has_topic_draft) {
      this.composer.openNewTopicDraft();
      return;
    }

    let targetCategory = this.createTopicTargetCategory;

    if (!targetCategory) {
      // Should never happen - the button is disabled when there is no eligible category
      throw "No eligible category for new topic";
    }

    this.composer.openNewTopic({ category: targetCategory });
  }
}
