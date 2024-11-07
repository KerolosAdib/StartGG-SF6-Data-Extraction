import { ApolloClient, InMemoryCache, createHttpLink } from "@apollo/client";
import { setContext } from "@apollo/client/link/context";

const httpLink = createHttpLink({
    uri: "https://api.start.gg/gql/alpha",
});

const authLink = setContext((_, { headers }) => {
    return {
        headers: {
            ...headers,
            authorization: "Bearer 5a4790d6c71d9f5e1a00c53663fcaeca",
        },
    };
});

const client = new ApolloClient({
    link: authLink.concat(httpLink),
    cache: new InMemoryCache(),
});

export default client;
