from __future__ import annotations

import pandas as pd
import streamlit as st

from analytics import AnalyticsEngine
from collectors import CollectionRequest
from api.services import CollectionService
from storage.database import SessionLocal, init_database
from storage.repository import JobRepository


st.set_page_config(page_title="Job Intelligence Platform", layout="wide")
init_database()

st.title("Job Intelligence Platform")

with st.sidebar:
    st.header("Collect")
    search_term = st.text_input("Search term", value="Senior .NET Developer")
    location = st.text_input("Location", value="Texas")
    sites = st.multiselect(
        "Sources",
        ["linkedin", "indeed", "google", "zip_recruiter", "glassdoor"],
        default=["linkedin", "indeed"],
    )
    results_wanted = st.number_input("Results wanted", min_value=1, max_value=1000, value=50)
    collect_clicked = st.button("Run collection", type="primary")

session = SessionLocal()
try:
    if collect_clicked:
        request = CollectionRequest(
            search_term=search_term,
            location=location,
            sites=sites,
            results_wanted=int(results_wanted),
        )
        run, result = CollectionService(session).collect(request)
        st.success(f"Run {run.id} collected {result.count} jobs")
        if result.errors:
            st.warning("\n".join(result.errors))

    tabs = st.tabs(["Explorer", "Analytics", "Companies"])

    with tabs[0]:
        keyword = st.text_input("Keyword")
        remote = st.selectbox("Remote", ["Any", "Remote", "Non-remote"], index=0)
        remote_filter = None if remote == "Any" else remote == "Remote"
        jobs = JobRepository(session).list_jobs(keyword=keyword or None, remote=remote_filter, limit=250)
        rows = [
            {
                "Title": job.title,
                "Company": job.company_name,
                "Location": job.location,
                "Remote": job.is_remote,
                "Source": job.source,
                "Min salary": job.min_amount,
                "Max salary": job.max_amount,
                "URL": job.job_url,
            }
            for job in jobs
        ]
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

    with tabs[1]:
        analytics = AnalyticsEngine(session).overview()
        col1, col2 = st.columns(2)
        with col1:
            st.subheader("Trending Companies")
            st.bar_chart(pd.DataFrame(analytics["trending_companies"]).set_index("company"))
            st.subheader("Location Trends")
            st.bar_chart(pd.DataFrame(analytics["location_trends"]).set_index("location"))
        with col2:
            st.subheader("Requested Skills")
            skills = pd.DataFrame(analytics["most_requested_skills"])
            if not skills.empty:
                st.bar_chart(skills.set_index("skill"))
            st.subheader("Salary Trends")
            st.json(analytics["salary_trends"])

    with tabs[2]:
        companies = JobRepository(session).list_companies(limit=500)
        st.dataframe(
            pd.DataFrame([{"Company": company.name, "Website": company.website_url} for company in companies]),
            use_container_width=True,
            hide_index=True,
        )
finally:
    session.close()
