from flask import Flask, jsonify, render_template, request
import data_processor as dp

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/summary")
def api_summary():
    level = request.args.get("level", "all")
    category = request.args.get("category", "") or None
    year_month = request.args.get("year_month", "") or None
    avg_start = request.args.get("avg_start") or None
    avg_end = request.args.get("avg_end") or None
    return jsonify(dp.get_summary_stats(
        level=level, category=category, year_month=year_month,
        avg_start=avg_start, avg_end=avg_end,
    ))


@app.route("/api/monthly")
def api_monthly():
    raw = request.args.get("categories", "")
    categories = [c.strip() for c in raw.split(",") if c.strip()] if raw else None
    start = request.args.get("start") or None
    end = request.args.get("end") or None
    granularity = request.args.get("granularity") or "month"
    parent = request.args.get("parent") or None
    group_by = request.args.get("group_by") or None
    return jsonify(dp.get_monthly_totals(
        categories,
        start=start,
        end=end,
        granularity=granularity,
        parent=parent,
        group_by=group_by,
    ))


@app.route("/api/categories")
def api_categories():
    year_month = request.args.get("year_month", "")
    return jsonify(dp.get_category_breakdown(year_month or None))


@app.route("/api/transactions")
def api_transactions():
    search = request.args.get("search", "")
    category = request.args.get("category", "")
    parent   = request.args.get("parent", "")
    year_month = request.args.get("year_month", "")
    start_day = request.args.get("start_day", type=int)
    end_day   = request.args.get("end_day", type=int)
    page     = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))
    result = dp.get_transactions(
        search=search, category=category, parent=parent, year_month=year_month,
        start_day=start_day, end_day=end_day,
        page=page, per_page=per_page,
    )
    return jsonify(result)


@app.route("/api/radial")
def api_radial():
    category = request.args.get("category", "")
    parent   = request.args.get("parent", "")
    return jsonify(dp.get_radial_data(category or None, parent=parent or None))


@app.route("/api/category-detail")
def api_category_detail():
    category   = request.args.get("category", "")
    year_month = request.args.get("year_month", "")
    level      = request.args.get("level", "leaf")
    if not year_month:
        return jsonify({"error": "year_month required"}), 400
    if level != "all" and not category:
        return jsonify({"error": "category required when level != 'all'"}), 400
    return jsonify(dp.get_category_detail(category, year_month, level=level))


@app.route("/api/category-hierarchy")
def api_category_hierarchy():
    year_month = request.args.get("year_month") or None
    start      = request.args.get("start") or None
    end        = request.args.get("end") or None
    return jsonify(dp.get_category_hierarchy(year_month, start=start, end=end))


@app.route("/api/top-categories")
def api_top_categories():
    year_month  = request.args.get("year_month", "")
    exclude_raw = request.args.get("exclude", "")
    exclude = [c.strip() for c in exclude_raw.split(",") if c.strip()] if exclude_raw else []
    if not year_month:
        return jsonify({"error": "year_month required"}), 400
    return jsonify(dp.get_top_categories(year_month, exclude or None))


@app.route("/api/categories/list")
def api_categories_list():
    return jsonify(dp.get_categories_list())


@app.route("/api/category-meta")
def api_category_meta():
    return jsonify(dp.get_category_meta())


@app.route("/api/months/list")
def api_months_list():
    return jsonify(dp.get_months_list())


@app.route("/api/overview/snapshot")
def api_overview_snapshot():
    month = request.args.get("month", "") or None
    return jsonify(dp.get_overview_snapshot(month))


@app.route("/api/overview/budget")
def api_overview_budget():
    month = request.args.get("month", "") or None
    return jsonify(dp.get_overview_budget_data(month))


@app.route("/api/overview/budget/months")
def api_overview_budget_months():
    return jsonify(dp.get_overview_budget_months())


@app.route("/api/datasets")
def api_datasets():
    return jsonify(dp.list_datasets())


@app.route("/api/datasets/active", methods=["POST"])
def api_set_active_dataset():
    key = (request.get_json(silent=True) or {}).get("key", "")
    try:
        dp.set_active_dataset(key)
    except ValueError:
        return jsonify({"ok": False, "error": "invalid dataset key"}), 400
    return jsonify({"ok": True})


if __name__ == "__main__":
    import os
    dp.load_data()
    dp.load_full_data()

    if os.environ.get("FLASK_ENV") == "production":
        app.run(port=int(os.environ.get("PORT", 5001)))
    else:
        from livereload import Server
        server = Server(app.wsgi_app)
        server.watch("templates/")
        server.watch("static/js/")
        server.watch("static/css/")
        server.watch("data_processor.py")
        server.serve(port=5001, host="0.0.0.0")
