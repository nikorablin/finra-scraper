const fetch = require("node-fetch");
const request = require("request");
const qs = require("qs");
const stringify = require("stringify-object");
const isEmpty = require("lodash/isEmpty");
const cookie = require("cookie");
const tabletojson = require("tabletojson");

const getCookies = () => Promise.all([
  fetch.post("http://finra-markets.morningstar.com/finralogin.jsp"),
  fetch.get(
    "http://doc.morningstar.com/BondDoc.aspx?clientid=pst&key=2a32c10e40ff4620"
  )
]).then(([details, propsectus]) => ({
    detailsCookie: cookie.parse(details.headers["set-cookie"][0]),
    propsectusCookie: cookie.parse(propsectus.headers["set-cookie"][0])
  }));


const getBondCookies = () => fetch
  .post("http://finra-markets.morningstar.com/finralogin.jsp")
  .then(response => cookie.parse(response.headers["set-cookie"][0]));

const formatElements = arr => arr.filter(item => Object.keys(item).length > 1).map(([name, value]) => ({ name, value }));

const formatProspectus = propsectusData => {
  if (propsectusData.Msg === "false") return [];
  return propsectusData.BondDocumentReport.Registration.map(item => ({
    date: item.EffectiveDate,
    name: item.DisplayName,
    url: `http://doc.morningstar.com/document/${item.DocId}.msdoc`
  }));
};

const getBondDetails = (bond, bondCookie) => Promise.all([
    fetch.get(
      `http://mschart.morningstar.com/chartweb/defaultChart?type=getbond&t=${
        bond.securityId
      }&startdate=1900-01-01&enddate=2017-06-14&format=1&charttype=price`
    ),
    fetch.get(
      `http://mschart.morningstar.com/chartweb/defaultChart?type=getbond&t=${
        bond.securityId
      }&startdate=1900-01-01&enddate=2017-06-14&format=1&charttype=yield`
    ),
    fetch.get(
      `http://quotes.morningstar.com/bondq/quote/c-bond?&t=${bond.securityId}`
    ),
    fetch.get(
      `http://quotes.morningstar.com/bondq/quote/c-classification?&t=${
        bond.securityId
      }`
    ),
    fetch.get(
      `http://quotes.morningstar.com/bondq/quote/c-credit?&t=${bond.securityId}`
    ),
    fetch.get(
      `http://quotes.morningstar.com/bondq/quote/c-issue?&t=${bond.securityId}`
    ),
    fetch.get(
      `http://doc.morningstar.com/ajaxService/GetBondData.ashx?identifier=${
        bond.cusip
      }&IdentifierType=1&action=getBondInfo`,
      {
        headers: {
          Cookie: request.cookie(`MDLAUTH=${bondCookie}`)
        }
      }
    )
  ]).then(
    ([
      prices,
      yields,
      bondElements,
      classificationElements,
      ratingElements,
      issueElements,
      prospectus
    ]) => ({
      ...bond,
      priceHistory: prices.data.data,
      yieldHistory: yields.data.data,
      bondElements: formatElements(
        tabletojson.convert(bondElements.data.html)[0]
      ),
      classificationElements: formatElements(
        tabletojson.convert(classificationElements.data.html)[0]
      ),
      ratingElements: formatElements(
        tabletojson.convert(ratingElements.data.html)[0]
      ),
      issueElements: formatElements(
        tabletojson.convert(issueElements.data.html)[0]
      ),
      prospectus: formatProspectus(prospectus.data.data)
    })
  );

const getBonds = (company, existingSymbols = []) => getCookies()
  .then(cookies => {
    const query = stringify({
      Keywords: [
        { Name: "debtOrAssetClass", Value: "3" },
        { Name: "showResultsAs", Value: "B" },
        { Name: "issuerName", Value: company }
      ]
    });
    const data = qs.stringify({ count: 400, query, searchtype: "B" });
    return fetch({
      url: "http://finra-markets.morningstar.com/bondSearch.jsp",
      method: "post",
      data,
      headers: {
        Referer: "http://finra-markets.morningstar.com/BondCenter/Results.jsp",
        Cookie: request.cookie(`qs_wsid=${cookies.detailsCookie.qs_wsid}`)
      }
    }).then(response => {
      if (isEmpty(response.data)) {
        return Promise.resolve({});
      }
      const parsed = JSON.parse(
        response.data.replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2": ')
      );
      return Promise.all(
        parsed.B.Columns.map(bond => {
          if (existingSymbols.some(existing => existing === bond.symbol)) {
            return bond;
          }
          return getBondDetails(bond, cookies.propsectusCookie.MDLAUTH);
        })
      ).then(bonds => bonds);
    });
  });


const getLastPrice = symbol => getBondCookies().then(cookies => {
    const query = stringify({
      Keywords: [{ Name: "traceOrCusipOrBloomberg", Value: symbol }]
    });
    const data = qs.stringify({ count: 1, query, searchtype: "B" });
    return fetch({
      url: "http://finra-markets.morningstar.com/bondSearch.jsp",
      method: "post",
      data,
      headers: {
        Referer: "http://finra-markets.morningstar.com/BondCenter/Results.jsp",
        Cookie: request.cookie(`qs_wsid=${cookies.qs_wsid}`)
      }
    }).then(response => {
      if (isEmpty(response.data)) {
        return Promise.resolve({});
      }
      const parsed = JSON.parse(
        response.data.replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2": ')
      );
      const bond = parsed.B.Columns[0];
      return {
        symbol: bond.symbol,
        cusip: bond.cusip,
        yield: bond.yield,
        price: bond.price,
        tradeDate: bond.tradeDate
      };
    });
  });


module.exports = {
  getLastPrice,
  getBonds
};
