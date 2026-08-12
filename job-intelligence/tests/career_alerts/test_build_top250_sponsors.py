from openpyxl import Workbook

from tools.build_top250_sponsors import build_top250


def test_build_top250_aggregates_exact_employer_names(tmp_path):
    path = tmp_path / "sponsors.xlsx"
    book = Workbook()
    sheet = book.active
    sheet.title = "Employer Information"
    sheet.append(["title"])
    sheet.append(["disclaimer"])
    sheet.append([
        "Sl No", "Fiscal Year", "Employer (Petitioner) Name", "Tax ID",
        "Industry (NAICS) Code", "Petitioner City", "Petitioner State",
        "Petitioner Zip Code", "New Employment Approval", "New Employment Denial",
        "Continuation Approval", "Continuation Denial",
    ])
    sheet.append([1, 2026, "Acme LLC", "1", "54", "Dallas", "TX", "75001", 4, 0, 6, 0])
    sheet.append([2, 2026, "Acme LLC", "1", "54", "Plano", "TX", "75024", 2, 0, 3, 0])
    sheet.append([3, 2026, "Beta Inc", "2", "51", "Austin", "TX", "78701", 5, 0, 1, 0])
    book.save(path)

    result = build_top250(path)

    assert result[0] == {
        "rank": 1,
        "sponsor_name": "Acme LLC",
        "new_approvals": 6,
        "continuation_approvals": 9,
        "total_approvals": 15,
    }
    assert result[1]["sponsor_name"] == "Beta Inc"
