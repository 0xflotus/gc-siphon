const debug = require("debug")("gc:siphon:g2fetch");
const mysql = require("mysql");

const metrics = require("./metrics");

function processG2({ gcs }) {
  return new Promise((resolve, reject) => {
    const connection = mysql.createConnection(
      process.env["GC_G2_URI"] || "mysql://localhost/G2"
    );

    connection.connect();

    let yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const query = connection.query(
      "SELECT WP, Api, ApiUpdateTime FROM WP WHERE ApiUpdateTime >= ?",
      yesterday
    );

    query.on("error", err => {
      debug("Error %o", err);
      connection.end();
      reject(err);
    });

    let fetchCount = 0;
    let skipCount = 0;

    query.on("result", row => {
      connection.pause();

      gcs.findOne({ _id: row.WP }, { api_date: 1 }).then(fdoc => {
        if (fdoc !== null && fdoc.api_date >= row.ApiUpdateTime) {
          //debug(
          //"Skip update %s (%o vs. %o)",
          //row.WP,
          //fdoc.api_date,
          //row.ApiUpdateTime
          //);
          skipCount++;
          connection.resume();
        } else {
          debug("Update %s", row.WP);
          const doc = {
            _id: row.WP,
            api: JSON.parse(row.Api),
            api_date: row.ApiUpdateTime,
            api_source: "g2",
            parsed_refresh: true
          };
          gcs
            .update({ _id: doc._id }, { $set: doc }, { upsert: true })
            .then(() => {
              connection.resume();
            })
            .catch(err => {
              connection.end();
              reject(err);
            });
          fetchCount++;
        }
      });
    });

    query.on("end", () => {
      metrics.increment("fetch.count", fetchCount, ["source:g2"]);
      metrics.increment("fetch.skipped", skipCount, ["source:g2"]);
      debug("Done");
      connection.end();
      resolve();
    });
  });
}

module.exports = processG2;
