package app.toolbox.tasks;

import java.util.HashSet;
import java.util.Set;

/** Per-widget configuration: how one placed widget filters, groups and sorts. */
final class WidgetConfig {
    /** "category" | "date" | "none". */
    String groupBy = "category";
    /** Selected category ids; empty = all. */
    final Set<String> cats = new HashSet<>();
    /** Selected date buckets (overdue/today/week/later/none); empty = all. */
    final Set<String> buckets = new HashSet<>();
    /** "due" | "priority" | "priority-due". */
    String sort = "due";
}
