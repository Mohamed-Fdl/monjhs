import { DirectoryElement } from "../types";

const ListingHtml = `<!doctype html>
<html lang="en">

<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Index of /</title>
    <style>
        :root {
            font-family: system-ui, sans-serif;
            font-size: 14px;
            color: #111;
        }

        body {
            margin: 24px;
        }

        h1 {
            font-size: 16px;
            margin-bottom: 12px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th,
        td {
            text-align: left;
            padding: 6px 8px;
        }

        th {
            color: #666;
            font-size: 12px;
            font-weight: 600;
            border-bottom: 1px solid #ccc;
        }

        td.size {
            text-align: right;
            color: #666;
            font-variant-numeric: tabular-nums;
        }

        a {
            color: inherit;
            text-decoration: none;
        }
    </style>
</head>

<body>
    <h1>Index of /</h1>

    <table>
        <thead>
            <tr>
                <th>Name</th>
                <th class="size">Size (kb)</th>
            </tr>
        </thead>
        <tbody>
            #{{LISTING}}#
        </tbody>
    </table>
</body>

</html>`;

export const DirectoryListing = (data: DirectoryElement[]): string => {
  let listing = ``;
  data.forEach((element) => {
    const href = `${element.fileName}${!element.isFile ? "/" : ""}`;
    listing += `<tr>
            <td><a href="${href}">${href}</a></td>
            <td class="size">${(element.size / 1024).toFixed(2)}</td>
        </tr>`;
  });

  return ListingHtml.replace("#{{LISTING}}#", listing);
};
