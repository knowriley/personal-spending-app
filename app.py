from flask import Flask, jsonify, render_template, request
import data_processor as dp

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/summary")
def api_summary():
    return jsonify(dp.get_summary_stats())


@app.route("/api/monthly")
def api_monthly():
    return jsonify(dp.get_monthly_totals())


@app.route("/api/categories")
def api_categories():
    year_month = request.args.get("year_month", "")
    return jsonify(dp.get_category_breakdown(year_month or None))


@app.route("/api/trends")
def api_trends():
    raw = request.args.get("categories", "")
    categories = [c.strip() for c in raw.split(",") if c.strip()] if raw else None
    return jsonify(dp.get_spending_trends(categories))


@app.route("/api/transactions")
def api_transactions():
    search = request.args.get("search", "")
    category = request.args.get("category", "")
    year_month = request.args.get("year_month", "")
    page = int(request.args.get("page", 1))
    result = dp.get_transactions(search=search, category=category, year_month=year_month, page=page)
    return jsonify(result)


@app.route("/api/categories/list")
def api_categories_list():
    return jsonify(dp.get_categories_list())


@app.route("/api/months/list")
def api_months_list():
    return jsonify(dp.get_months_list())


if __name__ == "__main__":
    # warm up data on start
    dp.load_data()
    app.run(debug=True, port=5001)
